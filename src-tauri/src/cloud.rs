//! 云端数据文件下载（检查更新流程的取文件环节）。

use crate::state::{command_error, AppState, CommandResult};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;
use tauri::{Manager, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// 同步和软件更新共用用户配置的 Base URL，安装包不内置服务器地址。
#[tauri::command]
pub async fn check_for_update(
    webview: Webview,
    base_url: String,
) -> CommandResult<Option<UpdateMetadata>> {
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err(command_error("invalid_url", "请先填写服务器 Base URL"));
    }
    let base = reqwest::Url::parse(base_url).map_err(|e| command_error("invalid_url", e))?;
    if !matches!(base.scheme(), "http" | "https")
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || !matches!(base.path(), "" | "/")
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err(command_error("invalid_url", "Base URL 只需填写协议、主机及可选端口"));
    }
    let endpoint = base
        .join("/api/v1/updates/latest")
        .map_err(|e| command_error("invalid_url", e))?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| command_error("updater", e))?
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| command_error("updater", e))?;
    let Some(update) = updater.check().await.map_err(|e| command_error("updater", e))? else {
        return Ok(None);
    };
    let metadata = UpdateMetadata {
        rid: webview.resources_table().add(update.clone()),
        current_version: update.current_version,
        version: update.version,
        date: update.raw_json.get("pub_date").and_then(|v| v.as_str()).map(str::to_owned),
        body: update.body,
        raw_json: update.raw_json,
    };
    Ok(Some(metadata))
}

/// 从云端按哈希取文件，并以索引中的原文件名写入中转目录，返回保存路径。
#[tauri::command]
pub async fn cloud_download_file(
    url: String,
    token: String,
    file_hash: String,
    file_ext: String,
    file_name: String,
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
    let dest: PathBuf = dest_dir.join(safe_download_name(&file_name, &file_hash, &ext));

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
    // 同名残留只可能是上次中断留下的中转文件；正式导入按内容哈希去重。
    let _ = std::fs::remove_file(&dest);
    std::fs::rename(&tmp, &dest).map_err(|e| command_error("io", e))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn safe_download_name(file_name: &str, hash: &str, ext: &str) -> String {
    let leaf = file_name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let mut output = String::new();
    for ch in leaf.chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
            output.push('_');
        } else {
            output.push(ch);
        }
    }
    let output = output.trim_matches([' ', '.']).to_string();
    if output.is_empty() {
        format!("{hash}.{ext}")
    } else {
        output.chars().take(240).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::safe_download_name;

    #[test]
    fn download_name_preserves_server_file_name_and_blocks_paths() {
        assert_eq!(
            safe_download_name("张三 A04_AF26.xrk", "a".repeat(64).as_str(), "xrk"),
            "张三 A04_AF26.xrk"
        );
        assert_eq!(
            safe_download_name("..\\raw\\session 01.xrk", "a".repeat(64).as_str(), "xrk"),
            "session 01.xrk"
        );
        assert_eq!(
            safe_download_name("", "a".repeat(64).as_str(), "xrk"),
            format!("{}.xrk", "a".repeat(64))
        );
    }
}

/// 导入成功后清理云端下载中转文件；出于安全只允许删除 <缓存>/cloud-downloads 内的路径。
#[tauri::command]
pub fn cloud_remove_transit(path: String, state: State<'_, Arc<AppState>>) -> CommandResult<()> {
    let transit_dir = state.cache.path().join("cloud-downloads");
    let target = PathBuf::from(&path);
    // 已不存在视为清理完成（重复同步/并发导入下幂等）
    if !target.exists() {
        return Ok(());
    }
    let dir = std::fs::canonicalize(&transit_dir).map_err(|e| command_error("io", e))?;
    let file = std::fs::canonicalize(&target).map_err(|e| command_error("io", e))?;
    if !file.starts_with(&dir) {
        return Err(command_error("invalid_path", "只允许清理云端下载中转目录内的文件"));
    }
    std::fs::remove_file(&file).map_err(|e| command_error("io", e))?;
    Ok(())
}

/// 更新安装完成后退出应用（重新打开即为新版本）。
#[tauri::command]
pub fn exit_app() {
    std::process::exit(0);
}
