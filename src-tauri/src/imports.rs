use crate::{
    jobs::ImportJob,
    state::{cache_error, command_error, AppState, CommandResult},
};
use cache_core::{CacheState, SourceIdentity};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use telemetry_core::{ChannelSeries, SessionMeta};
use telemetry_ipc::{CmdError, ImportStage, QueuedImport};

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn queued_outcome(job_id: u64, file_name: &str) -> QueuedImport {
    QueuedImport {
        job_id: Some(job_id),
        file_name: file_name.to_string(),
        status: "queued".into(),
        message: None,
    }
}

fn duplicate_outcome(file_name: &str) -> QueuedImport {
    QueuedImport {
        job_id: None,
        file_name: file_name.to_string(),
        status: "duplicate".into(),
        message: Some("库内已存在相同数据的记录，未重复导入".into()),
    }
}

fn failed_outcome(file_name: &str, message: &str) -> QueuedImport {
    QueuedImport {
        job_id: None,
        file_name: file_name.to_string(),
        status: "failed".into(),
        message: Some(message.to_string()),
    }
}

fn io_err(error: std::io::Error) -> CmdError {
    command_error("io_error", error)
}

fn fail_job(state: &AppState, id: u64, message: &str) {
    if let Some(mut job) = state.jobs.get_mut(&id) {
        if !job.status.stage.is_terminal() {
            let _ = job.transition(ImportStage::Failed);
            job.status.error = Some(message.to_string());
        }
    }
}

/// 解开导入 zip：只提取 xrk/xrz/csv 文件（拍平文件名防 zip-slip），返回临时目录与文件列表。
fn unzip_import_archive(path: &Path) -> Result<(PathBuf, Vec<PathBuf>), CmdError> {
    let file = std::fs::File::open(path).map_err(io_err)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| command_error("zip_error", format!("无法读取 zip: {e}")))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("scut-import-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    let mut extracted: Vec<PathBuf> = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| command_error("zip_error", format!("损坏的 zip 条目: {e}")))?;
        if entry.is_dir() {
            continue;
        }
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let Some(raw_name) = enclosed.file_name().map(|name| name.to_owned()) else {
            continue;
        };
        let ext = raw_name
            .to_string_lossy()
            .rsplit('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "xrk" | "xrz" | "csv") {
            continue;
        }
        let dest = dir.join(format!("{index:04}_{}", raw_name.to_string_lossy()));
        let mut out = std::fs::File::create(&dest).map_err(io_err)?;
        std::io::copy(&mut entry, &mut out).map_err(io_err)?;
        extracted.push(dest);
    }
    Ok((dir, extracted))
}

impl AppState {
    /// 统一多文件导入入口（拖入 / 文件对话框 / 路径输入）。
    /// zip 解包后逐文件入队；库内已存在相同内容 hash 的 Ready 缓存即判重复跳过。
    pub async fn import_files(
        self: &Arc<Self>,
        paths: Vec<PathBuf>,
    ) -> CommandResult<Vec<QueuedImport>> {
        let mut files: Vec<PathBuf> = Vec::new();
        let mut outcomes: Vec<QueuedImport> = Vec::new();
        for path in paths {
            let ext = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase())
                .unwrap_or_default();
            match ext.as_str() {
                "zip" => {
                    let open = tauri::async_runtime::spawn_blocking({
                        let path = path.clone();
                        move || unzip_import_archive(&path)
                    })
                    .await
                    .map_err(|e| command_error("import_task_failed", e))?;
                    match open {
                        Ok((dir, inner)) if inner.is_empty() => {
                            outcomes.push(failed_outcome(
                                &file_name_of(&path),
                                "zip 内没有可导入的 xrk/xrz/csv 文件",
                            ));
                            let _ = std::fs::remove_dir_all(&dir);
                        }
                        Ok((dir, inner)) => {
                            self.register_temp_dir(&dir, inner.len());
                            files.extend(inner);
                        }
                        Err(error) => {
                            outcomes.push(failed_outcome(&file_name_of(&path), &error.message))
                        }
                    }
                }
                "xrk" | "xrz" | "csv" => files.push(path),
                other => outcomes.push(failed_outcome(
                    &file_name_of(&path),
                    &format!("不支持的文件类型: .{other}"),
                )),
            }
        }
        for path in files {
            let owning_temp_dir = self.temp_dir_owner(&path);
            outcomes.push(self.import_one(path, owning_temp_dir).await);
        }
        Ok(outcomes)
    }

    async fn import_one(
        self: &Arc<Self>,
        path: PathBuf,
        owning_temp_dir: Option<PathBuf>,
    ) -> QueuedImport {
        let file_name = file_name_of(&path);
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "xrk" | "xrz" | "csv") {
            if let Some(dir) = owning_temp_dir.clone() {
                self.release_temp_dir(&dir);
            }
            return failed_outcome(&file_name, &format!("不支持的文件类型: .{ext}"));
        }
        let identity = match tauri::async_runtime::spawn_blocking({
            let path = path.clone();
            move || SourceIdentity::from_path(&path)
        })
        .await
        {
            Ok(Ok(identity)) => identity,
            Ok(Err(error)) => {
                if let Some(dir) = owning_temp_dir.clone() {
                    self.release_temp_dir(&dir);
                }
                return failed_outcome(&file_name, &cache_error(error).message);
            }
            Err(e) => {
                if let Some(dir) = owning_temp_dir.clone() {
                    self.release_temp_dir(&dir);
                }
                return failed_outcome(&file_name, &command_error("import_task_failed", e).message);
            }
        };

        // 同文件在途导入：直接返回现有 job（防双击重复排队）
        {
            let imports = self.imports.lock().expect("imports mutex poisoned");
            if let Some(existing) = imports.get(&identity.hash) {
                if self
                    .jobs
                    .get(existing)
                    .is_some_and(|job| !job.status.stage.is_terminal())
                {
                    if let Some(dir) = owning_temp_dir.clone() {
                        self.release_temp_dir(&dir);
                    }
                    return queued_outcome(*existing, &file_name);
                }
            }
        }

        // 内容 hash 是库内 identity：任何格式的 Ready 记录都不重复导入。
        if self
            .cache
            .dataset(&identity.hash)
            .is_ok_and(|dataset| dataset.manifest().state == CacheState::Ready)
        {
            if let Some(dir) = owning_temp_dir.clone() {
                self.release_temp_dir(&dir);
            }
            return duplicate_outcome(&file_name);
        }

        let id = self.allocate_id();
        let mut job = ImportJob::new(id);
        job.status.file_hash = identity.hash.clone();
        self.jobs.insert(id, job);
        self.imports
            .lock()
            .expect("imports mutex poisoned")
            .insert(identity.hash.clone(), id);
        let state = self.clone();
        tauri::async_runtime::spawn(async move {
            let result = match ext.as_str() {
                "csv" => state.run_import_csv(id, path, identity).await,
                _ => state.run_import_xrk(id, path, identity).await,
            };
            if let Err(error) = result {
                fail_job(&state, id, &error.message);
            }
            if let Some(dir) = owning_temp_dir {
                state.release_temp_dir(&dir);
            }
        });
        queued_outcome(id, &file_name)
    }

    /// 顶栏路径输入的单文件入口：重复/失败以 Err 表达，成功返回 job id。
    pub async fn start_import(self: &Arc<Self>, path: PathBuf) -> CommandResult<u64> {
        let outcomes = self.import_files(vec![path]).await?;
        match outcomes.into_iter().next() {
            Some(outcome) if outcome.status == "queued" => outcome
                .job_id
                .ok_or_else(|| command_error("import_failed", "queued outcome missing job id")),
            Some(outcome) if outcome.status == "duplicate" => Err(command_error(
                "duplicate_import",
                outcome.message.unwrap_or_else(|| "重复记录".into()),
            )),
            Some(outcome) => Err(command_error(
                "import_failed",
                outcome.message.unwrap_or_else(|| "导入失败".into()),
            )),
            None => Err(command_error("invalid_import_path", "没有可导入的文件")),
        }
    }

    /// xrk/xrz：DLL 解析 → 全通道样本 → 网格化生成 raw/pyramid 缓存，并保留原始文件。
    async fn run_import_xrk(
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
        let meta = SessionMeta {
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
        // Filter out AiM's synthetic interpolated GPS channels entirely.
        // Only real physical sensors (Standard), raw GPS (GpsRaw), and
        // physically-derived GPS (DerivedGps, DerivedCalc) are imported.
        let mut channels: Vec<telemetry_core::ChannelMeta> = metadata
            .channels
            .iter()
            .filter(|c| c.source != telemetry_core::ChannelSource::Gps)
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
        let laps = metadata.laps.clone();
        {
            let mut job = self
                .jobs
                .get_mut(&id)
                .ok_or_else(|| command_error("job_not_found", id))?;
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.transition(ImportStage::ReadingChannels)?;
            job.enqueue(keys.clone());
        }
        if self
            .jobs
            .get(&id)
            .is_some_and(|job| job.status.stage == ImportStage::Cancelled)
        {
            return Ok(());
        }
        let loaded = self
            .aim
            .read_channels(path.clone(), keys.clone())
            .await
            .map_err(|e| command_error("dll_error", e))?;
        let samples: HashMap<String, ChannelSeries> = loaded.series;
        for key in &keys {
            if !samples.contains_key(key) {
                return Err(command_error("channel_not_found", key));
            }
        }
        for loaded_channel in loaded.channels {
            if let Some(channel) = channels.iter_mut().find(|channel| channel.key == loaded_channel.key) {
                channel.sample_rate_hz = loaded_channel.sample_rate_hz;
            }
        }
        if let Some(mut job) = self.jobs.get_mut(&id) {
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.status.progress = 1.0;
        }
        {
            let mut job = self
                .jobs
                .get_mut(&id)
                .ok_or_else(|| command_error("job_not_found", id))?;
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.transition(ImportStage::BuildingRawCache)?;
        }
        let root = self.cache.clone();
        let original_path = path.clone();
        let original_ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("xrk")
            .to_ascii_lowercase();
        let build = tauri::async_runtime::spawn_blocking(move || -> Result<String, CmdError> {
            let mut meta = meta;
            // All channels are real (Gps filtered at import); duration = max end.
            if let Some(end) = samples
                .values()
                .filter_map(|series| series.times.last().copied())
                .filter(|time| time.is_finite())
                .reduce(f64::max)
            {
                meta.duration = end;
            }
            if root
                .dataset(&identity.hash)
                .is_ok_and(|dataset| dataset.manifest().state == CacheState::Ready)
            {
                return Err(command_error(
                    "duplicate_import",
                    "库内已存在相同数据的记录，未重复导入",
                ));
            }
            let mut cache = root
                .publish_metadata(identity.clone(), meta, channels, laps)
                .map_err(cache_error)?;
            let dataset_dir = root.path().join("datasets").join(&identity.hash);
            std::fs::copy(
                &original_path,
                dataset_dir.join(format!("source.{original_ext}")),
            )
            .map_err(io_err)?;
            let channel_keys: Vec<String> = cache
                .manifest()
                .channels
                .iter()
                .map(|e| e.meta.key.clone())
                .collect();
            for key in &channel_keys {
                let series = samples
                    .get(key)
                    .ok_or_else(|| command_error("channel_not_found", key))?;
                if series.is_empty() {
                    continue;
                }
                cache.build_overview(key, series).map_err(cache_error)?;
                cache.build_pyramid(key).map_err(cache_error)?;
            }
            cache.mark_ready().map_err(cache_error)?;
            Ok(identity.hash)
        })
        .await
        .map_err(|e| command_error("import_task_failed", e))?;
        let hash = build.inspect_err(|error| {
            fail_job(self, id, &error.message);
        })?;
        if let Some(mut job) = self.jobs.get_mut(&id) {
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.status.file_hash = hash;
            job.status.meta_ready = true;
            job.status.progress = 1.0;
            job.transition(ImportStage::BuildingPyramid)?;
            job.transition(ImportStage::Ready)?;
        }
        Ok(())
    }

    /// csv：内容 hash 即 identity → 规范解析 → 发布缓存（复制 source.csv 入库）。
    async fn run_import_csv(
        &self,
        id: u64,
        path: PathBuf,
        identity: SourceIdentity,
    ) -> CommandResult<()> {
        if self
            .cache
            .dataset(&identity.hash)
            .is_ok_and(|dataset| dataset.manifest().state == CacheState::Ready)
        {
            if let Some(mut job) = self.jobs.get_mut(&id) {
                let _ = job.transition(ImportStage::Duplicate);
                job.status.error = Some("库内已存在相同数据的记录，未重复导入".into());
            }
            return Ok(());
        }
        let source = path.clone();
        let parsed = tauri::async_runtime::spawn_blocking(move || {
            csv_parser::parse_csv(&source).map_err(|e| command_error("csv_error", e))
        })
        .await
        .map_err(|e| command_error("import_task_failed", e))??;
        {
            let mut job = self
                .jobs
                .get_mut(&id)
                .ok_or_else(|| command_error("job_not_found", id))?;
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.transition(ImportStage::ReadingChannels)?;
            job.transition(ImportStage::BuildingRawCache)?;
        }
        let root = self.cache.clone();
        let build = tauri::async_runtime::spawn_blocking(move || -> Result<(), CmdError> {
            let mut cache = root
                .publish_metadata(identity.clone(), parsed.meta, parsed.channels, parsed.laps)
                .map_err(cache_error)?;
            let dataset_dir = root.path().join("datasets").join(&identity.hash);
            std::fs::copy(&path, dataset_dir.join("source.csv")).map_err(io_err)?;
            let channel_keys: Vec<String> = cache
                .manifest()
                .channels
                .iter()
                .map(|e| e.meta.key.clone())
                .collect();
            for key in &channel_keys {
                let series = parsed
                    .series
                    .get(key)
                    .ok_or_else(|| command_error("channel_not_found", key))?;
                cache.build_overview(key, series).map_err(cache_error)?;
                cache.build_pyramid(key).map_err(cache_error)?;
            }
            cache.mark_ready().map_err(cache_error)
        })
        .await
        .map_err(|e| command_error("import_task_failed", e))?;
        build.inspect_err(|error| {
            fail_job(self, id, &error.message);
        })?;
        if let Some(mut job) = self.jobs.get_mut(&id) {
            if job.status.stage.is_terminal() {
                return Ok(());
            }
            job.status.progress = 1.0;
            job.transition(ImportStage::BuildingPyramid)?;
            job.transition(ImportStage::Ready)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::{
        future::Future,
        pin::Pin,
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
    fn test_state(tag: &str) -> (Arc<AppState>, PathBuf) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let dll = root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll");
        let cache_dir =
            std::env::temp_dir().join(format!("scut-import-{tag}-{}", std::process::id()));
        let state = Arc::new(AppState::new(&cache_dir, &dll).unwrap());
        (state, cache_dir)
    }
    fn wait_ready(state: &AppState, job_id: u64) -> telemetry_ipc::ImportStatus {
        let mut waited = 0;
        loop {
            let status = state.import_status(job_id).unwrap();
            if status.stage.is_terminal() {
                return status;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
            waited += 25;
            if waited > 120_000 {
                panic!("import timed out at stage {:?}", status.stage);
            }
        }
    }
    fn write_sample_csv(path: &Path, session: &str, vehicle: &str, racer: &str, date: &str) {
        use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource};
        let ch = ChannelMeta {
            key: "Speed".into(),
            name: "Speed".into(),
            unit: "km/h".into(),
            source: ChannelSource::Csv,
            dtype: ChannelDType::Numeric,
            sample_rate_hz: 0.0,
        };
        let series = ChannelSeries {
            times: vec![0.0, 0.5, 1.0, 1.5, 2.0],
            values: vec![10.0, 20.0, 30.0, 40.0, 50.0],
        };
        let grid = telemetry_core::gridify(2.0, &[(&ch, &series)]).unwrap();
        let meta = SessionMeta {
            file_path: path.to_path_buf(),
            file_type: "csv".into(),
            session: session.into(),
            vehicle: vehicle.into(),
            racer: racer.into(),
            championship: String::new(),
            comment: String::new(),
            date: date.into(),
            start_time: "14:00:00".into(),
            sample_rate_hz: 0.0,
            duration: 2.0,
        };
        let mut buffer = Vec::new();
        telemetry_core::write_aim_csv(&mut buffer, &meta, &grid, 1).unwrap();
        std::fs::write(path, buffer).unwrap();
    }

    #[test]
    fn real_xrk_import_preserves_original_and_window_frame_works() {
        let _guard = lock();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let (state, cache_dir) = test_state("xrk-csv");
        let source = root.join("Data/AGX.xrk");
        let outcomes = block_on(state.import_files(vec![source.clone()])).unwrap();
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].status, "queued");
        let job_id = outcomes[0].job_id.unwrap();
        let status = wait_ready(&state, job_id);
        assert_eq!(status.stage, telemetry_ipc::ImportStage::Ready);
        assert!(status.meta_ready);
        // 原始 XRK 内容 hash 是库内 identity。
        let original = SourceIdentity::from_path(&source).unwrap();
        assert_eq!(status.file_hash, original.hash);
        let source_xrk = state
            .cache
            .path()
            .join("datasets")
            .join(&status.file_hash)
            .join("source.xrk");
        assert!(
            source_xrk.exists(),
            "source.xrk must be stored inside the library"
        );
        let cached = state.cache.dataset(&status.file_hash).unwrap();
        let ends: Vec<f64> = cached
            .manifest()
            .channels
            .iter()
            .filter_map(|entry| cached.read_raw(&entry.meta.key).ok())
            .filter_map(|series| series.times.last().copied())
            .collect();
        let min_end = ends.iter().copied().reduce(f64::min).unwrap();
        let max_end = ends.iter().copied().reduce(f64::max).unwrap();
        assert!(
            max_end - min_end > 0.1,
            "raw channels must retain their native end times, got {min_end}..{max_end}"
        );
        assert!(
            cached.manifest().meta.duration < 88.7,
            "duration must not be extended by synthetic GPS tail, got {}",
            cached.manifest().meta.duration
        );
        assert_eq!(cached.manifest().meta.duration, max_end);
        let handle = state.open_handle(&status.file_hash).unwrap();
        let frame = state
            .window_series(handle, "GPS Speed", 0., 10., 128, 37)
            .unwrap();
        let (_, times, mins, maxs) = telemetry_ipc::decode_frame(&frame).unwrap();
        assert!(!times.is_empty());
        assert_eq!(times.len(), mins.len());
        assert_eq!(mins.len(), maxs.len());
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn real_xrk_import_prioritize_channel_reorders_queue() {
        let _guard = lock();
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf();
        let (state, cache_dir) = test_state("prioritize");
        let source = root.join("Data/AGX.xrk");
        let outcomes = block_on(state.import_files(vec![source])).unwrap();
        let job_id = outcomes[0].job_id.unwrap();
        // D17 管线：通道队列在 ReadingChannels 阶段即入列（样本读完才发布元数据），
        // 等待条件改为 pending 非空。
        let mut waited = 0;
        loop {
            let ready = state
                .jobs
                .get(&job_id)
                .map(|job| !job.status.stage.is_terminal() && !job.pending.is_empty())
                .unwrap_or(false);
            if ready {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            waited += 10;
            if waited > 120_000 {
                panic!("timed out waiting for import queue");
            }
        }
        let target_channel = "GPS Speed".to_string();
        state
            .prioritize_import(job_id, std::slice::from_ref(&target_channel))
            .expect("prioritize_import succeeds");
        let idx = state
            .jobs
            .get(&job_id)
            .unwrap()
            .pending
            .iter()
            .position(|key| key == &target_channel)
            .expect("target channel must remain in queue");
        assert_eq!(idx, 0, "target channel must be first after prioritize");
        state.cancel_import(job_id).expect("cancel succeeds");
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn csv_import_and_duplicate_detection_end_to_end() {
        let _guard = lock();
        let (state, cache_dir) = test_state("csv");
        let dir = std::env::temp_dir().join(format!("scut-import-csv-src-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let csv_path = dir.join("SCUT_FP2.csv");
        write_sample_csv(&csv_path, "FP2", "SCUT-24", "LIN", "2026-09-15");

        let outcomes = block_on(state.import_files(vec![csv_path.clone()])).unwrap();
        assert_eq!(outcomes[0].status, "queued");
        let job_id = outcomes[0].job_id.unwrap();
        let status = wait_ready(&state, job_id);
        assert_eq!(status.stage, telemetry_ipc::ImportStage::Ready);
        let handle = state.open_handle(&status.file_hash).unwrap();
        let frame = state.window_series(handle, "Speed", 0., 2., 64, 5).unwrap();
        let (_, times, _, _) = telemetry_ipc::decode_frame(&frame).unwrap();
        assert!(!times.is_empty());

        // 重复导入同一 csv → duplicate，且不产生新 job
        let again = block_on(state.import_files(vec![csv_path])).unwrap();
        assert_eq!(again[0].status, "duplicate");
        assert!(again[0].job_id.is_none());
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[test]
    fn zip_import_extracts_and_queues_inner_files() {
        let _guard = lock();
        let (state, cache_dir) = test_state("zip");
        let dir = std::env::temp_dir().join(format!("scut-import-zip-src-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let csv_path = dir.join("inner.csv");
        write_sample_csv(&csv_path, "ZipSession", "SCUT-25", "DU", "2026-09-14");
        let zip_path = dir.join("bundle.zip");
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let options: zip::write::SimpleFileOptions = Default::default();
            zip.start_file("inner.csv", options).unwrap();
            std::io::copy(&mut std::fs::File::open(&csv_path).unwrap(), &mut zip).unwrap();
            zip.finish().unwrap();
        }
        let outcomes = block_on(state.import_files(vec![zip_path])).unwrap();
        assert_eq!(outcomes.len(), 1, "non-telemetry zip entries are skipped");
        assert_eq!(outcomes[0].status, "queued");
        let job_id = outcomes[0].job_id.unwrap();
        let status = wait_ready(&state, job_id);
        assert_eq!(status.stage, telemetry_ipc::ImportStage::Ready);
        let datasets = state.cache.path().join("datasets");
        assert_eq!(datasets.read_dir().unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(cache_dir);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn guangke_xrk_file_duration_bounds_to_physical_sensors() {
        let _guard = lock();
        let target = PathBuf::from(
            r"D:\Desktop\A04_AF26 有无人跑动 广科 2026-09-13\Jiaxuan Lin_A04_AF26_Guangke_a_3330.xrk",
        );
        if !target.exists() {
            return;
        }
        let (state, cache_dir) = test_state("guangke-test");
        let outcomes = block_on(state.import_files(vec![target.clone()])).unwrap();
        assert_eq!(outcomes.len(), 1);
        let job_id = outcomes[0].job_id.unwrap();
        let status = wait_ready(&state, job_id);
        assert_eq!(status.stage, telemetry_ipc::ImportStage::Ready);
        let cached = state.cache.dataset(&status.file_hash).unwrap();
        let duration = cached.manifest().meta.duration;
        assert!(
            (duration - 641.406).abs() < 0.001,
            "expected physical sensor duration 641.406, got {duration}"
        );
        assert!(
            !cached.manifest().channels.iter().any(|c| c.meta.source == telemetry_core::ChannelSource::Gps),
            "AiM interpolated GPS channels should not be imported"
        );
        let _ = std::fs::remove_dir_all(cache_dir);
    }
}
