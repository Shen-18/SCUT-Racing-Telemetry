//! Desktop state owns lazy handles, not full-resolution telemetry datasets.
use crate::jobs::ImportJob;
use cache_core::{CacheError, CacheRoot, DatasetCache};
use dashmap::DashMap;
use std::{
    path::{Path, PathBuf},
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
    /// zip 解包临时目录 → 未完成内部文件引用计数；归零即删除目录。
    pub(crate) temp_dirs: std::sync::Mutex<std::collections::HashMap<PathBuf, usize>>,
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
            temp_dirs: std::sync::Mutex::new(std::collections::HashMap::new()),
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

    /// Deletes one dataset's cache directory (library-home record deletion).
    /// Closes any open handle first; the source file is never touched (D10).
    pub fn purge_hash(&self, hash: &str) -> CommandResult<u64> {
        // The hash becomes a directory name; only a plain 64-char hex digest is valid.
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(command_error("invalid_hash", hash));
        }
        let mut purged = 0u64;
        let stale: Vec<u64> = self
            .datasets
            .iter()
            .filter(|entry| entry.value().manifest().identity.hash == hash)
            .map(|entry| *entry.key())
            .collect();
        for id in stale {
            if self.datasets.remove(&id).is_some() {
                purged += 1;
            }
        }
        let dir = self.cache.path().join("datasets").join(hash);
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => Ok(purged + 1),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(purged),
            Err(e) => Err(command_error("io_error", e)),
        }
    }

    /// 登记一个 zip 解包目录及其内部待导入文件数。
    pub fn register_temp_dir(&self, dir: &Path, files: usize) {
        self.temp_dirs
            .lock()
            .expect("temp_dirs mutex poisoned")
            .insert(dir.to_path_buf(), files);
    }

    /// 内部文件导入终态后归还引用；归零删除整个解包目录。
    pub fn release_temp_dir(&self, dir: &Path) {
        let mut remove = false;
        if let Ok(mut map) = self.temp_dirs.lock() {
            if let Some(count) = map.get_mut(dir) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(dir);
                    remove = true;
                }
            }
        }
        if remove {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// 找到路径所属的已登记临时目录（zip 内部文件归属）。
    pub fn temp_dir_owner(&self, path: &Path) -> Option<PathBuf> {
        let map = self.temp_dirs.lock().ok()?;
        map.keys().find(|dir| path.starts_with(dir)).cloned()
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
