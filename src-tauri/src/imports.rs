use crate::{
    jobs::ImportJob,
    state::{cache_error, command_error, AppState, CommandResult},
};
use cache_core::{CacheState, SourceIdentity};
use std::{path::PathBuf, sync::Arc};
use telemetry_ipc::ImportStage;

impl AppState {
    pub async fn start_import(self: &Arc<Self>, path: PathBuf) -> CommandResult<u64> {
        let (path, identity) = tauri::async_runtime::spawn_blocking(move || {
            let paths = crate::batch::expand(vec![path], false)?;
            if paths.len() != 1 {
                return Err(command_error("invalid_import_path", "expected one file"));
            }
            let path = paths.into_iter().next().expect("length checked");
            let identity = SourceIdentity::from_path(&path).map_err(cache_error)?;
            Ok((path, identity))
        })
        .await
        .map_err(|e| command_error("import_task_failed", e))??;
        let mut imports = self
            .imports
            .lock()
            .map_err(|e| command_error("state_error", e))?;
        if let Some(id) = imports.get(&identity.hash) {
            if self
                .jobs
                .get(id)
                .is_some_and(|j| !j.status.stage.is_terminal())
            {
                return Ok(*id);
            }
        }
        let id = self.allocate_id();
        let mut job = ImportJob::new(id);
        job.status.file_hash = identity.hash.clone();
        if self
            .cache
            .dataset(&identity.hash)
            .is_ok_and(|d| d.manifest().state == CacheState::Ready)
        {
            job.status.stage = ImportStage::Ready;
            job.status.progress = 1.0;
            job.status.meta_ready = true;
            self.jobs.insert(id, job);
            imports.insert(identity.hash, id);
            return Ok(id);
        }
        self.jobs.insert(id, job);
        imports.insert(identity.hash.clone(), id);
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = state.run_import(id, path, identity).await {
                if let Some(mut job) = state.jobs.get_mut(&id) {
                    if !job.status.stage.is_terminal() {
                        let _ = job.transition(ImportStage::Failed);
                        job.status.error = Some(error.message);
                    }
                }
            }
        });
        Ok(id)
    }

    async fn run_import(
        &self,
        id: u64,
        path: PathBuf,
        identity: SourceIdentity,
    ) -> CommandResult<()> {
        let metadata = self
            .aim
            .metadata(path.clone())
            .await
            .map_err(|e| command_error("dll_error", e))?;
        let meta = telemetry_core::SessionMeta {
            file_path: metadata.meta.file_path.clone(),
            file_type: metadata.meta.file_type.clone(),
            session: metadata.meta.session.clone(),
            vehicle: metadata.meta.vehicle.clone(),
            racer: metadata.meta.racer.clone(),
            championship: metadata.meta.championship.clone(),
            date: metadata.meta.date.clone(),
            start_time: metadata.meta.start_time.clone(),
            duration: metadata.meta.duration,
            ..Default::default()
        };
        let channels: Vec<_> = metadata
            .channels
            .iter()
            .cloned()
            .map(|c| telemetry_core::ChannelMeta {
                key: c.key,
                name: c.name,
                unit: c.unit,
                source: c.source,
                dtype: c.dtype,
                sample_rate_hz: 0.0,
            })
            .collect();
        let keys: Vec<String> = channels.iter().map(|c| c.key.clone()).collect();
        let root = self.cache.clone();
        let identity_for_write = identity.clone();
        let laps = metadata.laps.clone();
        tauri::async_runtime::spawn_blocking(move || {
            root.publish_metadata(identity_for_write, meta, channels, laps)
        })
        .await
        .map_err(|e| command_error("import_task_failed", e))?
        .map_err(cache_error)?;
        {
            let mut job = self
                .jobs
                .get_mut(&id)
                .ok_or_else(|| command_error("job_not_found", id))?;
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.transition(ImportStage::ReadingChannels)?;
            job.status.meta_ready = true;
            job.enqueue(keys.clone());
            job.transition(ImportStage::BuildingRawCache)?;
        }
        let total = keys.len().max(1);
        for index in 0..keys.len() {
            if self
                .jobs
                .get(&id)
                .is_some_and(|j| j.status.stage == ImportStage::Cancelled)
            {
                return Ok(());
            }
            let key = self
                .jobs
                .get_mut(&id)
                .and_then(|mut job| job.claim_next())
                .ok_or_else(|| command_error("import_queue_empty", id))?;
            let dataset = self
                .aim
                .read_channels(path.clone(), vec![key.clone()])
                .await
                .map_err(|e| command_error("dll_error", e))?;
            let series = dataset
                .series
                .get(&key)
                .ok_or_else(|| command_error("channel_not_found", &key))?
                .clone();
            let root = self.cache.clone();
            let hash = identity.hash.clone();
            let key_for_write = key.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut cache = root.dataset(&hash).map_err(cache_error)?;
                cache
                    .build_overview(&key_for_write, &series)
                    .map_err(cache_error)?;
                cache.build_pyramid(&key_for_write).map_err(cache_error)
            })
            .await
            .map_err(|e| command_error("cache_task_failed", e))??;
            if let Some(mut job) = self.jobs.get_mut(&id) {
                job.status.progress = (index + 1) as f32 / total as f32;
            }
            if index == 0 {
                if let Some(mut job) = self.jobs.get_mut(&id) {
                    job.transition(ImportStage::BuildingPyramid)?;
                }
            }
        }
        let root = self.cache.clone();
        let hash = identity.hash.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut cache = root.dataset(&hash).map_err(cache_error)?;
            cache.mark_ready().map_err(cache_error)
        })
        .await
        .map_err(|e| command_error("cache_task_failed", e))??;
        if let Some(mut job) = self.jobs.get_mut(&id) {
            job.status.progress = 1.0;
            job.transition(ImportStage::Ready)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::jobs::ImportJob;
    use cache_core::SourceIdentity;
    use std::{
        future::Future,
        path::PathBuf,
        pin::Pin,
        sync::Arc,
        task::{Context, Poll, RawWaker, RawWakerVTable, Waker},
    };
    fn block_on<F: Future>(mut future: F) -> F::Output {
        fn no(_: *const ()) {}
        fn clone(p: *const ()) -> RawWaker {
            RawWaker::new(p, &VT)
        }
        static VT: RawWakerVTable = RawWakerVTable::new(clone, no, no, no);
        let w = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VT)) };
        let mut cx = Context::from_waker(&w);
        let mut p = unsafe { Pin::new_unchecked(&mut future) };
        loop {
            if let Poll::Ready(v) = p.as_mut().poll(&mut cx) {
                return v;
            }
            std::thread::yield_now()
        }
    }
    fn lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    #[test]
    fn real_agx_import_publishes_metadata_and_precomputed_window_frame() {
        let _guard = lock();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let source = root.join("Data/AGX.xrk");
        let dll = root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll");
        let cache_dir =
            std::env::temp_dir().join(format!("scut-step4-integration-{}", std::process::id()));
        let state = Arc::new(AppState::new(&cache_dir, &dll).unwrap());
        let id = state.allocate_id();
        let identity = SourceIdentity::from_path(&source).unwrap();
        let mut job = ImportJob::new(id);
        job.status.file_hash = identity.hash.clone();
        state.jobs.insert(id, job);
        block_on(state.run_import(id, source, identity.clone())).unwrap();
        let status = state.import_status(id).unwrap();
        assert_eq!(status.stage, telemetry_ipc::ImportStage::Ready);
        assert!(status.meta_ready);
        let dataset = state.open_handle(&status.file_hash).unwrap();
        let frame = state
            .window_series(dataset, "GPS Speed (AiM Interpolated)", 0., 10., 128, 37)
            .unwrap();
        let (_, times, mins, maxs) = telemetry_ipc::decode_frame(&frame).unwrap();
        assert!(!times.is_empty());
        assert_eq!(times.len(), mins.len());
        assert_eq!(mins.len(), maxs.len());
        let header: telemetry_ipc::FrameHeader = serde_json::from_slice(
            &frame[8..8 + u32::from_le_bytes(frame[4..8].try_into().unwrap()) as usize],
        )
        .unwrap();
        assert_eq!(header.generation, 37);
        assert_eq!(header.channel, "GPS Speed (AiM Interpolated)");
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn real_xrk_import_prioritize_channel_reorders_queue_and_generates_proof() {
        let _guard = lock();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let source = root.join("Data/AGX.xrk");
        let dll = root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll");
        let cache_dir =
            std::env::temp_dir().join(format!("scut-step5-prioritize-{}", std::process::id()));
        let state = Arc::new(AppState::new(&cache_dir, &dll).unwrap());
        let id = state.allocate_id();
        let identity = SourceIdentity::from_path(&source).unwrap();
        let mut job = ImportJob::new(id);
        job.status.file_hash = identity.hash.clone();
        state.jobs.insert(id, job);

        let mut log_lines: Vec<String> = Vec::new();
        log_lines.push(
            "================================================================================"
                .to_string(),
        );
        log_lines
            .push("SCUT Racing Telemetry - Step 5 In-Flight Prioritize Import Proof".to_string());
        log_lines.push(
            "================================================================================"
                .to_string(),
        );
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        log_lines.push(format!("Unix Timestamp: {}", now));
        log_lines.push(format!("Source File: {}", source.display()));
        log_lines.push(format!(
            "Source File Size: {} bytes",
            std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0)
        ));
        log_lines.push(format!("File SHA-256: {}", identity.hash));
        log_lines.push(format!("Allocated Job ID: {}", id));
        log_lines.push("Status: Spawning asynchronous import worker thread...".to_string());

        let state_clone = state.clone();
        let source_clone = source.clone();
        let identity_clone = identity.clone();
        let worker = std::thread::spawn(move || {
            block_on(state_clone.run_import(id, source_clone, identity_clone))
        });

        // 1. Wait until meta_ready and channels enqueued
        let mut waited_ms = 0;
        loop {
            if let Some(j) = state.jobs.get(&id) {
                if j.status.meta_ready && !j.pending.is_empty() {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            waited_ms += 10;
            if waited_ms > 30_000 {
                panic!("Timed out waiting for meta_ready in real_xrk_import");
            }
        }

        log_lines.push(format!("Event: meta_ready reached after ~{}ms", waited_ms));

        // 2. Snapshot queue before prioritize
        let queue_before: Vec<String> = state
            .jobs
            .get(&id)
            .unwrap()
            .pending
            .iter()
            .cloned()
            .collect();
        log_lines.push(format!(
            "Pending queue total channels count: {}",
            queue_before.len()
        ));

        let target_channel = "GPS Speed (AiM Interpolated)".to_string();
        let idx_before = queue_before
            .iter()
            .position(|k| k == &target_channel)
            .expect("AGX.xrk must contain GPS Speed (AiM Interpolated)");
        log_lines.push(format!(
            "Target channel to prioritize: '{}'",
            target_channel
        ));
        log_lines.push(format!(
            "Queue BEFORE prioritize: channel '{}' located at index {} (0-based)",
            target_channel, idx_before
        ));
        assert!(
            idx_before > 0,
            "Target channel should not already be at front of queue"
        );

        let before_preview: Vec<String> = queue_before.iter().take(8).cloned().collect();
        log_lines.push(format!(
            "Queue BEFORE prioritize (first 8): {:?}",
            before_preview
        ));

        // 3. Call prioritize_import via AppState (actual backend logic invoked by IPC command)
        log_lines.push(format!(
            "ACTION: Calling prioritize_import(job_id={}, channels=['{}'])",
            id, target_channel
        ));
        state
            .prioritize_import(id, std::slice::from_ref(&target_channel))
            .expect("prioritize_import succeeds");

        // 4. Snapshot queue after prioritize
        let queue_after: Vec<String> = state
            .jobs
            .get(&id)
            .unwrap()
            .pending
            .iter()
            .cloned()
            .collect();
        let idx_after = queue_after
            .iter()
            .position(|k| k == &target_channel)
            .expect("Target channel must remain in queue");
        log_lines.push(format!(
            "Queue AFTER prioritize: channel '{}' relocated to index {} (front of queue)",
            target_channel, idx_after
        ));
        let after_preview: Vec<String> = queue_after.iter().take(8).cloned().collect();
        log_lines.push(format!(
            "Queue AFTER prioritize (first 8): {:?}",
            after_preview
        ));
        assert_eq!(
            idx_after, 0,
            "Target channel must be moved to index 0 after prioritization"
        );

        // 5. Open dataset handle and poll window_series until channel is ready
        let handle = state
            .open_handle(&identity.hash)
            .expect("open_handle succeeds");
        let mut build_waited_ms = 0;
        let frame = loop {
            match state.window_series(handle, &target_channel, 0.0, 10.0, 128, 42) {
                Ok(frame) => break frame,
                Err(e) if e.code == "channel_building" => {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    build_waited_ms += 50;
                    if build_waited_ms > 30_000 {
                        panic!(
                            "Timed out waiting for prioritized channel to finish building in cache"
                        );
                    }
                }
                Err(e) => panic!("Unexpected window_series error: {:?}", e),
            }
        };
        let frame_len = frame.len();

        // Verify target_channel was claimed by worker
        let claimed_channels: Vec<String> = state
            .jobs
            .get(&id)
            .unwrap()
            .claimed
            .iter()
            .cloned()
            .collect();
        log_lines.push(format!("Worker claimed channels: {:?}", claimed_channels));
        assert!(claimed_channels.contains(&target_channel));
        log_lines.push(format!(
            "Verification: Channel '{}' finished building in ~{}ms, window_series returned {} bytes valid SXK1 frame",
            target_channel, build_waited_ms, frame_len
        ));

        // 6. Cleanly cancel remaining import
        state.cancel_import(id).expect("cancel_import succeeds");
        log_lines.push(
            "ACTION: cancel_import dispatched to terminate remaining channel imports cleanly"
                .to_string(),
        );
        let _ = worker.join();

        let final_status = state.import_status(id).expect("import_status succeeds");
        log_lines.push(format!(
            "Final Job Status: stage={:?}, meta_ready={}, progress={:.2}",
            final_status.stage, final_status.meta_ready, final_status.progress
        ));
        log_lines.push(
            "================================================================================"
                .to_string(),
        );
        log_lines.push(
            "CONCLUSION: Click-to-prioritize end-to-end verified on real AGX.xrk. PASS."
                .to_string(),
        );
        log_lines.push(
            "================================================================================"
                .to_string(),
        );

        // Write log to .agent/evidence/step5/prioritize-proof.log
        let evidence_dir = root.join(".agent/evidence/step5");
        let _ = std::fs::create_dir_all(&evidence_dir);
        let log_path = evidence_dir.join("prioritize-proof.log");
        std::fs::write(&log_path, log_lines.join("\r\n") + "\r\n")
            .expect("write prioritize-proof.log");

        let _ = std::fs::remove_dir_all(cache_dir);
    }
}
