use telemetry_ipc::RecordSummary;
use telemetry_store::TelemetryStore;
use crate::state::{command_error, CommandResult};
use std::path::{Path, PathBuf};

/// 下载中转路径会被清理，记录的归档文件才是稳定的定位目标。
pub fn record_location(cache: &cache_core::CacheRoot, hash: &str) -> CommandResult<PathBuf> {
    let dataset = cache.dataset(hash).map_err(crate::state::cache_error)?;
    let original = dataset.manifest().meta.file_path.clone();
    let directory = cache.dataset_path_for_hash(hash).map_err(crate::state::cache_error)?;
    let mut candidates = Vec::new();
    if let Some(ext) = original.extension().and_then(|ext| ext.to_str()) {
        let ext = ext.to_ascii_lowercase();
        if matches!(ext.as_str(), "xrk" | "xrz" | "csv") {
            candidates.push(directory.join(format!("source.{ext}")));
        }
    }
    candidates.extend(["xrk", "xrz", "csv"].map(|ext| directory.join(format!("source.{ext}"))));
    candidates.push(original);
    let location = candidates.into_iter().find(|path| path.is_file()).unwrap_or(directory);
    location.canonicalize().map_err(|error| command_error("source_missing", error))
}

/// Windows 的 canonicalize 返回扩展路径，Explorer 需要普通磁盘/UNC 路径。
pub fn file_manager_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(plain) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(plain);
        }
    }
    path.to_path_buf()
}

pub fn list_records(
    store: &TelemetryStore,
    query: &str,
) -> Result<Vec<RecordSummary>, telemetry_store::StoreError> {
    store.list_records(query)
}
