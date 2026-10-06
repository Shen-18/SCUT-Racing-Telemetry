//! 云端数据文件下载（检查更新流程的取文件环节）。

use crate::state::{command_error, AppState, CommandResult};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// 从云端拉取一个数据文件到 <数据根>/cloud-downloads/<hash>.<ext>，返回保存路径。
#[tauri::command]
pub async fn cloud_download_file(
    url: String,
    token: String,
    file_hash: String,
    file_ext: String,
    state: State<'_, Arc<AppState>>,
) -> CommandResult<String> {
    if file_hash.len() != 64 || !file_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(command_error("invalid_hash", "file_hash 不是合法 SHA-256"));
    }
    let ext: String = file_ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if ext.is_empty() || ext.len() > 8 {
        return Err(command_error("invalid_ext", "file_ext 不合法"));
    }

    let dest_dir = state.cache.path().join("cloud-downloads");
    std::fs::create_dir_all(&dest_dir).map_err(|e| command_error("io", e))?;
    let dest: PathBuf = dest_dir.join(format!("{file_hash}.{ext}"));

    let endpoint = format!("{}/api/v1/files/{}", url.trim_end_matches('/'), file_hash);
    let response = reqwest::Client::new()
        .get(endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .timeout(Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| command_error("network", e))?;
    if !response.status().is_success() {
        return Err(command_error(
            "http",
            format!("服务器返回 HTTP {}", response.status().as_u16()),
        ));
    }
    let bytes = response.bytes().await.map_err(|e| command_error("network", e))?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err(command_error("too_large", "文件超过 512 MB 上限"));
    }

    let tmp = dest.with_extension(format!("{ext}.part"));
    std::fs::write(&tmp, &bytes).map_err(|e| command_error("io", e))?;
    std::fs::rename(&tmp, &dest).map_err(|e| command_error("io", e))?;
    Ok(dest.to_string_lossy().into_owned())
}
