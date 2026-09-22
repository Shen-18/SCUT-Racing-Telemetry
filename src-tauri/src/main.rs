#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)]
use scut_racing_telemetry::{
    batch, export, records,
    state::{self, command_error, AppState},
    stats_cmd, window_fit,
};
use std::{path::Path, path::PathBuf, sync::Arc};
use telemetry_ipc::{
    ChannelMeta, ChannelStatsDto, CmdError, DatasetMeta, ExportOutcome, ImportStatus, QueuedImport,
    RecordSummary, SampleRange,
};
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
async fn import_files(
    paths: Vec<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<QueuedImport>, CmdError> {
    state
        .import_files(paths.into_iter().map(PathBuf::from).collect())
        .await
}
#[tauri::command]
async fn pick_import_files() -> Result<Vec<String>, CmdError> {
    let files = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .add_filter("遥测文件 (xrk/xrz/csv/zip)", &["xrk", "xrz", "csv", "zip"])
            .pick_files()
    })
    .await
    .map_err(|e| command_error("dialog_task_failed", e))?;
    Ok(files
        .map(|list| {
            list.into_iter()
                .map(|path| path.display().to_string())
                .collect()
        })
        .unwrap_or_default())
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
fn authoritative_duration(
    dataset: &cache_core::DatasetCache,
    fallback: f64,
) -> Result<f64, CmdError> {
    // The source file's declared duration can be rounded or include a tail
    // after the final real sample.  Analysis metadata must use the raw span.
    Ok(dataset
        .sample_range(&[])
        .map_err(state::cache_error)?
        .map(|(_, end)| end)
        .unwrap_or(fallback))
}

fn dataset_meta_inner(id: u64, state: &AppState) -> Result<DatasetMeta, CmdError> {
    let dataset = state.dataset(id)?;
    let manifest = dataset.manifest();
    let mut meta = manifest.meta.clone();
    meta.duration = authoritative_duration(&dataset, meta.duration)?;
    Ok(DatasetMeta {
        id,
        file_hash: manifest.identity.hash.clone(),
        file_size: manifest.identity.size,
        meta,
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
fn sample_range(
    id: u64,
    channels: Vec<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Option<SampleRange>, CmdError> {
    state
        .dataset(id)?
        .sample_range(&channels)
        .map(|range| range.map(|(start, end)| SampleRange { start, end }))
        .map_err(state::cache_error)
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
    id: u64,
    channels: Vec<String>,
    start: f64,
    end: f64,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<std::collections::HashMap<String, ChannelStatsDto>, CmdError> {
    let dataset = state
        .datasets
        .get(&id)
        .ok_or_else(|| command_error("dataset_not_found", id))?;
    let hash = dataset.manifest().identity.hash.clone();
    drop(dataset);
    stats_cmd::window_stats(&state.cache, &hash, &channels, start, end)
}
#[tauri::command]
fn export_records(
    hashes: Vec<String>,
    dir: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<ExportOutcome>, CmdError> {
    export::export_records(&state.cache, &hashes, Path::new(&dir))
}

#[tauri::command]
fn export_channels(
    hash: String,
    channels: Vec<String>,
    start: f64,
    end: f64,
    out_path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CmdError> {
    export::export_channels(
        &state.cache,
        &hash,
        &channels,
        start,
        end,
        Path::new(&out_path),
    )
}

#[tauri::command]
async fn pick_export_folder() -> Result<Option<String>, CmdError> {
    let dir = tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().pick_folder())
        .await
        .map_err(|e| command_error("dialog_task_failed", e))?;
    Ok(dir.map(|p| p.display().to_string()))
}

#[tauri::command]
async fn pick_export_file(suggested_name: String) -> Result<Option<String>, CmdError> {
    let file = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_file_name(suggested_name)
            .add_filter("CSV", &["csv"])
            .save_file()
    })
    .await
    .map_err(|e| command_error("dialog_task_failed", e))?;
    Ok(file.map(|p| p.display().to_string()))
}

#[tauri::command]
fn list_records(
    query: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<Vec<RecordSummary>, CmdError> {
    Ok(records::scan_records(state.cache.path(), &query))
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
    id: u64,
    channels: Vec<String>,
    start: f64,
    end: f64,
    out_path: String,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), CmdError> {
    let dataset = state
        .datasets
        .get(&id)
        .ok_or_else(|| command_error("dataset_not_found", id))?;
    let wanted: Vec<String> = if channels.is_empty() {
        dataset
            .manifest()
            .channels
            .iter()
            .map(|channel| channel.meta.key.clone())
            .collect()
    } else {
        channels
    };
    let sample_range = dataset
        .sample_range(&wanted)
        .map_err(state::cache_error)?
        .ok_or_else(|| command_error("invalid_request", "no raw samples available for export"))?;
    let (global_start, global_end) = sample_range;
    let requested_start = if start.is_finite() {
        start
    } else {
        global_start
    };
    let requested_end = if end.is_finite() { end } else { global_end };
    let export_start = requested_start.max(global_start);
    let export_end = requested_end.min(global_end);
    if export_end < export_start {
        return Err(command_error(
            "invalid_request",
            "export range contains no samples",
        ));
    }
    let mut metadata = dataset.manifest().meta.clone();
    let mut grid = export::raw_grid(&dataset, &wanted, export_start, export_end)?;
    for time in &mut grid.times {
        *time -= export_start;
    }
    metadata.duration = grid.times.last().copied().unwrap_or(0.0);
    let file =
        std::fs::File::create(&out_path).map_err(|error| command_error("export_io", error))?;
    let mut writer = std::io::BufWriter::new(file);
    telemetry_core::csv_io::write_aim_csv(
        &mut writer,
        &metadata,
        &grid,
        dataset.manifest().laps.len(),
    )
    .map_err(|error| command_error("csv_error", error))?;
    std::io::Write::flush(&mut writer).map_err(|error| command_error("export_io", error))
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
fn purge_cache(
    file_hash: Option<String>,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<u64, CmdError> {
    match file_hash {
        Some(hash) => state.purge_hash(&hash),
        None => Err(command_error(
            "unsupported_command",
            "purge-all is scheduled for Step 8",
        )),
    }
}
/// 启动时把主窗口夹进当前屏幕可用区（ADR-0011）：只在真的超出时缩尺寸并居中，
/// 用户主动全屏/最大化时跳过，避免覆盖其选择。
fn clamp_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return;
    };
    let area = monitor.work_area().size;
    let want = window.inner_size().unwrap_or(area);
    let Some((w, h)) = window_fit::fit_into_area(want.width, want.height, area.width, area.height)
    else {
        return;
    };
    if w != want.width || h != want.height {
        let _ = window.set_size(tauri::LogicalSize::new(w as f64, h as f64));
        let _ = window.center();
    }
}

fn main() {
    let state = Arc::new(
        make_state().expect("SCUT Racing Telemetry requires a valid AiM DLL and cache root"),
    );
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(state)
        .setup(|app| {
            clamp_main_window(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_import,
            import_files,
            pick_import_files,
            start_import_batch,
            import_status,
            cancel_import,
            prioritize_import,
            open_dataset,
            close_dataset,
            dataset_meta,
            sample_range,
            window_series,
            cursor_values,
            laps,
            cache_root_status,
            stats,
            export_records,
            export_channels,
            pick_export_folder,
            pick_export_file,
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

#[cfg(test)]
mod tests {
    use super::authoritative_duration;
    use cache_core::{CacheRoot, SourceIdentity};
    use telemetry_core::{ChannelDType, ChannelMeta, ChannelSeries, ChannelSource, SessionMeta};

    #[test]
    fn duration_uses_last_raw_sample_instead_of_rounded_metadata() {
        let root_path = std::env::temp_dir().join(format!("scut-duration-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root_path);
        let root = CacheRoot::open(&root_path).unwrap();
        let hash = "a".repeat(64);
        root.publish_metadata(
            SourceIdentity {
                hash: hash.clone(),
                mtime: 1,
                size: 1,
            },
            SessionMeta {
                duration: 59.9,
                ..Default::default()
            },
            vec![ChannelMeta {
                dtype: ChannelDType::Numeric,
                key: "Speed".into(),
                name: "Speed".into(),
                unit: "km/h".into(),
                source: ChannelSource::Csv,
                sample_rate_hz: 100.0,
            }],
            vec![],
        )
        .unwrap();
        root.publish_raw(
            &hash,
            "Speed",
            &ChannelSeries {
                times: vec![0.0, 59.817],
                values: vec![1.0, 2.0],
            },
        )
        .unwrap();
        let dataset = root.dataset(&hash).unwrap();
        assert_eq!(authoritative_duration(&dataset, 59.9).unwrap(), 59.817);
        let _ = std::fs::remove_dir_all(root_path);
    }
}
