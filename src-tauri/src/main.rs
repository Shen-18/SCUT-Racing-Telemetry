#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)]
use scut_racing_telemetry::{
    batch,
    state::{self, command_error, AppState},
};
use std::{path::PathBuf, sync::Arc};
use telemetry_ipc::{ChannelMeta, CmdError, DatasetMeta, ImportStatus};
fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}
fn make_state() -> Result<AppState, CmdError> {
    let root = project_root();
    let dll = std::env::var_os("SCUT_AIM_DLL")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll"));
    let cache = std::env::var_os("SCUT_CACHE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(".cache"));
    AppState::new(&cache, &dll)
}
#[tauri::command]
async fn start_import(
    path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<u64, CmdError> {
    state.start_import(PathBuf::from(path)).await
}
#[tauri::command]
async fn start_import_batch(
    paths: Vec<String>,
    recursive: bool,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<u64>, CmdError> {
    let paths = batch::expand(paths.into_iter().map(PathBuf::from).collect(), recursive)?;
    let mut ids = Vec::new();
    for path in paths {
        ids.push(state.start_import(path).await?)
    }
    Ok(ids)
}
#[tauri::command]
fn import_status(
    job_id: u64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<ImportStatus, CmdError> {
    state.import_status(job_id)
}
#[tauri::command]
fn cancel_import(job_id: u64, state: tauri::State<'_, Arc<AppState>>) -> Result<(), CmdError> {
    state.cancel_import(job_id)
}
#[tauri::command]
fn prioritize_import(
    job_id: u64,
    channels: Vec<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CmdError> {
    state.prioritize_import(job_id, &channels)
}
fn dataset_meta_inner(id: u64, state: &AppState) -> Result<DatasetMeta, CmdError> {
    let dataset = state.dataset(id)?;
    let manifest = dataset.manifest();
    Ok(DatasetMeta {
        id,
        file_hash: manifest.identity.hash.clone(),
        meta: manifest.meta.clone(),
        channels: manifest
            .channels
            .iter()
            .map(|entry| ChannelMeta {
                key: entry.meta.key.clone(),
                name: entry.meta.name.clone(),
                unit: entry.meta.unit.clone(),
                dtype: entry.meta.dtype.clone(),
                source: entry.meta.source,
                sample_rate_hz: entry.meta.sample_rate_hz,
            })
            .collect(),
    })
}
#[tauri::command]
fn open_dataset(
    file_hash: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<DatasetMeta, CmdError> {
    let id = state.open_handle(&file_hash)?;
    dataset_meta_inner(id, &state)
}
#[tauri::command]
fn dataset_meta(id: u64, state: tauri::State<'_, Arc<AppState>>) -> Result<DatasetMeta, CmdError> {
    dataset_meta_inner(id, &state)
}
#[tauri::command]
fn close_dataset(id: u64, state: tauri::State<'_, Arc<AppState>>) -> Result<(), CmdError> {
    state.close_dataset(id)
}
#[tauri::command]
fn window_series(
    id: u64,
    channel: String,
    start: f64,
    end: f64,
    pixels: u32,
    generation: u64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<tauri::ipc::Response, CmdError> {
    state
        .window_series(id, &channel, start, end, pixels, generation)
        .map(tauri::ipc::Response::new)
}
#[tauri::command]
fn cursor_values(
    id: u64,
    channels: Vec<String>,
    t: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<f32>, CmdError> {
    state
        .dataset(id)?
        .read_cursor_values(&channels, t)
        .map_err(state::cache_error)
}
#[tauri::command]
fn laps(
    id: u64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<telemetry_core::LapInfo>, CmdError> {
    Ok(state.dataset(id)?.laps().to_vec())
}
#[tauri::command]
fn cache_root_status(state: tauri::State<'_, Arc<AppState>>) -> telemetry_ipc::CacheRootStatus {
    telemetry_ipc::CacheRootStatus {
        cache_bytes: state.cache.bytes().unwrap_or(0),
        db_path: state.cache.path().display().to_string(),
        mem_rss_bytes: 0,
        active_jobs: state
            .jobs
            .iter()
            .filter(|j| !j.status.stage.is_terminal())
            .count() as u32,
    }
}
#[tauri::command]
fn stats(
    _id: u64,
    _channels: Vec<String>,
    _start: f64,
    _end: f64,
) -> Result<serde_json::Value, CmdError> {
    Err(command_error(
        "unsupported_command",
        "stats is scheduled for Step 10",
    ))
}
#[tauri::command]
fn list_records(_query: String) -> Result<Vec<serde_json::Value>, CmdError> {
    Err(command_error(
        "unsupported_command",
        "records are scheduled for Step 11",
    ))
}
#[tauri::command]
fn delete_record(_record_id: i64) -> Result<(), CmdError> {
    Err(command_error(
        "unsupported_command",
        "records are scheduled for Step 11",
    ))
}
#[tauri::command]
fn export_csv(
    _id: u64,
    _channels: Vec<String>,
    _start: f64,
    _end: f64,
    _out_path: String,
) -> Result<(), CmdError> {
    Err(command_error(
        "unsupported_command",
        "export is scheduled for Step 12",
    ))
}
#[tauri::command]
fn comments(_record_id: i64) -> Result<Vec<serde_json::Value>, CmdError> {
    Err(command_error(
        "unsupported_command",
        "comments are scheduled for Step 11",
    ))
}
#[tauri::command]
fn add_comment(_record_id: i64, _t: f64, _text: String) -> Result<i64, CmdError> {
    Err(command_error(
        "unsupported_command",
        "comments are scheduled for Step 11",
    ))
}
#[tauri::command]
fn delete_comment(_id: i64) -> Result<(), CmdError> {
    Err(command_error(
        "unsupported_command",
        "comments are scheduled for Step 11",
    ))
}
#[tauri::command]
fn save_layout(_name: String, _json: String) -> Result<(), CmdError> {
    Err(command_error(
        "unsupported_command",
        "layouts are scheduled for Step 5",
    ))
}
#[tauri::command]
fn load_layout(_name: String) -> Result<Option<String>, CmdError> {
    Err(command_error(
        "unsupported_command",
        "layouts are scheduled for Step 5",
    ))
}
#[tauri::command]
fn estimate_offset(
    _id_a: u64,
    _id_b: u64,
    _channel: String,
    _start: f64,
    _end: f64,
) -> Result<f64, CmdError> {
    Err(command_error(
        "unsupported_command",
        "alignment is scheduled for Step 15",
    ))
}
#[tauri::command]
fn purge_cache(_file_hash: Option<String>) -> Result<u64, CmdError> {
    Err(command_error(
        "unsupported_command",
        "cache purge is scheduled for Step 8",
    ))
}
fn main() {
    let state = Arc::new(
        make_state().expect("SCUT Racing Telemetry requires a valid AiM DLL and cache root"),
    );
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            start_import,
            start_import_batch,
            import_status,
            cancel_import,
            prioritize_import,
            open_dataset,
            close_dataset,
            dataset_meta,
            window_series,
            cursor_values,
            laps,
            cache_root_status,
            stats,
            list_records,
            delete_record,
            export_csv,
            comments,
            add_comment,
            delete_comment,
            save_layout,
            load_layout,
            estimate_offset,
            purge_cache,
        ])
        .run(tauri::generate_context!())
        .expect("failed");
}
