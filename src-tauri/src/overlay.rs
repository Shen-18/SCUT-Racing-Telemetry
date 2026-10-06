use crate::state::{command_error, CommandResult};
use cache_core::DatasetCache;
use overlay::{gps_map_size, GpsGeometry, GpsRoute, RenderContext, SampleSeries};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Serialize)]
pub struct OverlayDemoResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn pick_overlay_file() -> CommandResult<Option<String>> {
    let file = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_file_name("overlay-demo.png")
            .add_filter("PNG", &["png"])
            .save_file()
    })
    .await
    .map_err(|error| command_error("dialog_task_failed", error))?;
    Ok(file.map(|path| path.display().to_string()))
}

#[tauri::command]
pub fn generate_overlay_demo(
    path: String,
    dataset_id: Option<u64>,
    bindings: Option<HashMap<String, String>>,
    width: Option<u32>,
    height: Option<u32>,
    state: tauri::State<'_, Arc<crate::state::AppState>>,
) -> CommandResult<OverlayDemoResult> {
    generate_overlay_demo_inner(&path, dataset_id, bindings, width, height, state.inner())
}

#[tauri::command]
pub fn generate_overlay_preview(
    dataset_id: Option<u64>,
    bindings: Option<HashMap<String, String>>,
    width: Option<u32>,
    height: Option<u32>,
    state: tauri::State<'_, Arc<crate::state::AppState>>,
) -> CommandResult<OverlayDemoResult> {
    let path = std::env::temp_dir().join(format!(
        "scut-overlay-preview-{}-{}.png",
        std::process::id(),
        state.allocate_id()
    ));
    let path_string = path.display().to_string();
    let result = generate_overlay_demo_inner(
        &path_string,
        dataset_id,
        bindings,
        width,
        height,
        state.inner(),
    );
    let _ = std::fs::remove_file(&path);
    result.map(|mut result| {
        result.path.clear();
        result
    })
}

fn generate_overlay_demo_inner(
    path: &str,
    dataset_id: Option<u64>,
    bindings: Option<HashMap<String, String>>,
    width: Option<u32>,
    height: Option<u32>,
    state: &crate::state::AppState,
) -> CommandResult<OverlayDemoResult> {
    if path.trim().is_empty() {
        return Err(command_error("invalid_output_path", "输出路径不能为空"));
    }
    let render_config = overlay::RenderConfig {
        width: width.unwrap_or(2560),
        height: height.unwrap_or(1440),
    };
    let (frame, render_context) = dataset_id
        .and_then(|id| state.datasets.get(&id).map(|dataset| (id, dataset)))
        .and_then(|(_, dataset)| {
            let bindings = bindings.as_ref()?;
            let keys: Vec<String> = bindings
                .values()
                .filter(|key| !key.trim().is_empty())
                .cloned()
                .collect();
            if keys.is_empty() {
                return None;
            }
            let (_, end) = dataset.sample_range(&keys).ok().flatten()?;
            let t = if end.is_finite() && end > 0.0 {
                end * 0.5
            } else {
                0.0
            };
            let values = dataset.read_cursor_values(&keys, t).ok()?;
            let lookup: HashMap<&str, f32> = keys
                .iter()
                .zip(values.iter())
                .map(|(key, value)| (key.as_str(), *value as f32))
                .collect();
            let get = |slot: &str| {
                bindings
                    .get(slot)
                    .and_then(|key| lookup.get(key.as_str()).copied())
                    .filter(|value| value.is_finite())
            };
            let mut frame = overlay::DemoFrame::blank(t as f32);
            frame.time_seconds = t as f32;
            frame.speed_kmh = get("speed").unwrap_or(f32::NAN);
            frame.throttle_percent = get("throttle").unwrap_or(f32::NAN);
            frame.brake_percent = get("brake").unwrap_or(f32::NAN);
            frame.g_x = get("acc_x").unwrap_or(f32::NAN);
            frame.g_y = get("acc_y").unwrap_or(f32::NAN);
            frame.gps_latitude = get("latitude").unwrap_or(f32::NAN);
            frame.gps_longitude = get("longitude").unwrap_or(f32::NAN);
            frame.steer_deg = get("steer").unwrap_or(f32::NAN);
            frame.soc_percent = get("battery_soc").unwrap_or(f32::NAN);
            frame.voltage = get("battery_volt").unwrap_or(f32::NAN);
            frame.current_a = get("battery_current").unwrap_or(f32::NAN);
            if let Some(brake_key) = bindings.get("brake").filter(|key| !key.trim().is_empty()) {
                if let Ok(series) = dataset.read_raw(brake_key) {
                    let finite = series
                        .values
                        .iter()
                        .copied()
                        .filter(|value| value.is_finite());
                    let (minimum, maximum) = finite.clone().fold(
                        (f64::INFINITY, f64::NEG_INFINITY),
                        |(minimum, maximum), value| (minimum.min(value), maximum.max(value)),
                    );
                    if minimum.is_finite() && maximum.is_finite() {
                        if frame.brake_percent.is_finite() {
                            frame.brake_percent = if (maximum - minimum).abs() <= f64::EPSILON {
                                0.
                            } else {
                                ((frame.brake_percent as f64 - minimum) / (maximum - minimum)
                                    * 100.) as f32
                            };
                        }
                    }
                }
            }
            for (index, wheel) in ["FL", "FR", "RL", "RR"].iter().enumerate() {
                frame.torque_nm[index] = get(&format!("motor_{wheel}_torque")).unwrap_or(f32::NAN);
            }
            frame.power_kw = if frame.voltage.is_finite() && frame.current_a.is_finite() {
                frame.voltage * frame.current_a / 1000.
            } else {
                f32::NAN
            };
            let render_context = load_render_context(&dataset, bindings, render_config).ok()?;
            Some((frame, render_context))
        })
        .unwrap_or_else(|| (overlay::DemoFrame::blank(0.0), RenderContext::default()));
    let report = overlay::render_png_with_context(&path, frame, render_config, &render_context)
        .map_err(|error| command_error("overlay_render", error))?;
    Ok(OverlayDemoResult {
        path: path.to_string(),
        width: report.width,
        height: report.height,
        bytes: report.bytes,
    })
}

fn load_render_context(
    dataset: &DatasetCache,
    bindings: &HashMap<String, String>,
    config: overlay::RenderConfig,
) -> Result<RenderContext, String> {
    let mut context = RenderContext {
        vehicle: dataset.manifest().meta.vehicle.clone(),
        racer: dataset.manifest().meta.racer.clone(),
        ..RenderContext::default()
    };
    let Some(latitude_key) = bindings
        .get("latitude")
        .filter(|key| !key.trim().is_empty())
    else {
        return Ok(context);
    };
    let Some(longitude_key) = bindings
        .get("longitude")
        .filter(|key| !key.trim().is_empty())
    else {
        return Ok(context);
    };
    let latitude = dataset
        .read_raw(latitude_key)
        .map_err(|error| error.to_string())?;
    let longitude = dataset
        .read_raw(longitude_key)
        .map_err(|error| error.to_string())?;
    let route = GpsRoute::from_series(
        &SampleSeries {
            times: latitude.times,
            values: latitude.values,
        },
        &SampleSeries {
            times: longitude.times,
            values: longitude.values,
        },
    );
    context.gps = GpsGeometry::from_route(&route).map(|mut geometry| {
        let (width, height) = gps_map_size(config);
        geometry.refit_for_map(width, height);
        geometry
    });
    Ok(context)
}
