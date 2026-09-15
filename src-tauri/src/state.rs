//! Desktop state owns lazy handles, not full-resolution telemetry datasets.
use crate::jobs::ImportJob;
use cache_core::{CacheError, CacheRoot, DatasetCache};
use dashmap::DashMap;
use std::{
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use telemetry_ipc::{CmdError, ImportStatus};

pub type CommandResult<T> = Result<T, CmdError>;

pub struct AppState {
    pub cache: CacheRoot,
    pub aim: aim_ffi::AimActor,
    pub datasets: DashMap<u64, Arc<DatasetCache>>,
    pub jobs: DashMap<u64, ImportJob>,
    pub(crate) imports: std::sync::Mutex<std::collections::HashMap<String, u64>>,
    next_id: AtomicU64,
}

pub fn command_error(code: &str, message: impl std::fmt::Display) -> CmdError {
    CmdError {
        code: code.into(),
        message: message.to_string(),
    }
}

pub fn cache_error(error: CacheError) -> CmdError {
    let code = match &error {
        CacheError::ChannelBuilding(_) => "channel_building",
        CacheError::UnknownChannel(_) => "channel_not_found",
        CacheError::InvalidRequest(_) => "invalid_request",
        CacheError::Busy => "cache_busy",
        _ => "cache_error",
    };
    command_error(code, error)
}

impl AppState {
    pub fn new(cache_path: &Path, dll_path: &Path) -> CommandResult<Self> {
        Ok(Self {
            cache: CacheRoot::open(cache_path).map_err(cache_error)?,
            aim: aim_ffi::AimActor::spawn(dll_path).map_err(|e| command_error("dll_error", e))?,
            datasets: DashMap::new(),
            jobs: DashMap::new(),
            next_id: AtomicU64::new(1),
            imports: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }

    pub fn allocate_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn import_status(&self, id: u64) -> CommandResult<ImportStatus> {
        self.jobs
            .get(&id)
            .map(|j| j.status.clone())
            .ok_or_else(|| command_error("job_not_found", id))
    }

    pub fn cancel_import(&self, id: u64) -> CommandResult<()> {
        self.jobs
            .get_mut(&id)
            .ok_or_else(|| command_error("job_not_found", id))?
            .transition(telemetry_ipc::ImportStage::Cancelled)
    }

    pub fn prioritize_import(&self, id: u64, channels: &[String]) -> CommandResult<()> {
        let mut job = self
            .jobs
            .get_mut(&id)
            .ok_or_else(|| command_error("job_not_found", id))?;
        job.prioritize(channels);
        Ok(())
    }

    /// Only the manifest is read here. No channel file is opened or built.
    pub fn open_handle(&self, hash: &str) -> CommandResult<u64> {
        let dataset = self.cache.dataset(hash).map_err(cache_error)?;
        let id = self.allocate_id();
        self.datasets.insert(id, Arc::new(dataset));
        Ok(id)
    }

    pub fn close_dataset(&self, id: u64) -> CommandResult<()> {
        self.datasets
            .remove(&id)
            .map(|_| ())
            .ok_or_else(|| command_error("dataset_not_found", id))
    }

    pub fn dataset(&self, id: u64) -> CommandResult<Arc<DatasetCache>> {
        let old = self
            .datasets
            .get(&id)
            .ok_or_else(|| command_error("dataset_not_found", id))?;
        // Refresh only metadata so an already-open partial dataset sees published channels.
        self.cache
            .dataset(&old.manifest().identity.hash)
            .map(Arc::new)
            .map_err(cache_error)
    }

    pub fn window_series(
        &self,
        id: u64,
        channel: &str,
        start: f64,
        end: f64,
        pixels: u32,
        generation: u64,
    ) -> CommandResult<Vec<u8>> {
        self.dataset(id)?
            .read_window_frame(channel, start, end, pixels, generation)
            .map_err(cache_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_entities_are_not_fabricated_as_success() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let state = AppState::new(
            &std::env::temp_dir().join(format!("step4-state-{}", std::process::id())),
            &root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll"),
        )
        .unwrap();
        assert!(state.open_handle(&"0".repeat(64)).is_err());
        assert!(state.datasets.is_empty());
        assert_eq!(state.import_status(99).unwrap_err().code, "job_not_found");
        assert_eq!(
            state.close_dataset(99).unwrap_err().code,
            "dataset_not_found"
        );
        assert_eq!(
            state
                .window_series(99, "Speed", 0.0, 1.0, 100, 2)
                .unwrap_err()
                .code,
            "dataset_not_found"
        );
    }
}
