use crate::state::{command_error, CommandResult};
use cache_core::DatasetCache;
use overlay::{
    build_timeline, gps_map_size, render_indices, render_overlay_png_with_context,
    render_rgba_with_context, sample_frame, BindingConfig, GpsGeometry, GpsRoute, RenderConfig,
    RenderContext, SampleSeries, SeriesSampler, SyncAnchor, TimelineConfig,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayExportRequest {
    pub dataset_id: u64,
    pub output_dir: String,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_render_fps")]
    pub render_fps: u32,
    #[serde(default = "default_timeline_fps")]
    pub timeline_fps: f64,
    #[serde(default)]
    pub output_start: f64,
    pub duration: Option<f64>,
    #[serde(default)]
    pub padding_head_seconds: f64,
    #[serde(default)]
    pub padding_tail_seconds: f64,
    #[serde(default)]
    pub offset_seconds: f64,
    #[serde(default)]
    pub anchors: Vec<OverlaySyncAnchor>,
    #[serde(default)]
    pub bindings: HashMap<String, String>,
    #[serde(default = "default_max_gap")]
    pub max_gap_seconds: f64,
    #[serde(default = "default_codec")]
    pub codec: String,
    #[serde(default = "default_workers")]
    pub workers: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySyncAnchor {
    pub data_seconds: f64,
    pub video_time: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayProgress {
    pub job_id: u64,
    pub status: String,
    pub current: usize,
    pub total: usize,
    pub output_frames: usize,
    pub fps: f64,
    pub elapsed: f64,
    pub eta: f64,
    pub percent: f64,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

pub struct OverlayJob {
    cancelled: AtomicBool,
    progress: Mutex<OverlayProgress>,
}

impl OverlayJob {
    fn new(job_id: u64) -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            progress: Mutex::new(OverlayProgress {
                job_id,
                status: "queued".into(),
                current: 0,
                total: 0,
                output_frames: 0,
                fps: 0.,
                elapsed: 0.,
                eta: 0.,
                percent: 0.,
                output_path: None,
                error: None,
            }),
        }
    }

    fn update(&self, update: impl FnOnce(&mut OverlayProgress)) {
        if let Ok(mut progress) = self.progress.lock() {
            update(&mut progress);
        }
    }

    pub fn snapshot(&self) -> OverlayProgress {
        self.progress
            .lock()
            .map(|progress| progress.clone())
            .unwrap_or_else(|_| OverlayProgress {
                job_id: 0,
                status: "failed".into(),
                current: 0,
                total: 0,
                output_frames: 0,
                fps: 0.,
                elapsed: 0.,
                eta: 0.,
                percent: 0.,
                output_path: None,
                error: Some("overlay job state unavailable".into()),
            })
    }
}

fn default_width() -> u32 {
    2560
}
fn default_height() -> u32 {
    1440
}
fn default_fps() -> u32 {
    100
}
fn default_render_fps() -> u32 {
    20
}
fn default_timeline_fps() -> f64 {
    100.
}
fn default_max_gap() -> f64 {
    0.5
}
fn default_codec() -> String {
    "qtrle".into()
}
fn default_workers() -> usize {
    8
}

#[tauri::command]
pub fn start_overlay_export(
    request: OverlayExportRequest,
    state: tauri::State<'_, Arc<crate::state::AppState>>,
) -> CommandResult<u64> {
    if request.output_dir.trim().is_empty() {
        return Err(command_error("invalid_output_path", "输出目录不能为空"));
    }
    let job_id = state.allocate_id();
    let job = Arc::new(OverlayJob::new(job_id));
    state.overlay_jobs.insert(job_id, Arc::clone(&job));
    let state = state.inner().clone();
    thread::spawn(move || {
        if let Err(error) = run_export(job_id, request, Arc::clone(&state), Arc::clone(&job)) {
            job.update(|progress| {
                progress.status = if error == "cancelled" {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                progress.error = Some(error);
            });
        }
    });
    Ok(job_id)
}

#[tauri::command]
pub fn overlay_export_status(
    job_id: u64,
    state: tauri::State<'_, Arc<crate::state::AppState>>,
) -> CommandResult<OverlayProgress> {
    state
        .overlay_jobs
        .get(&job_id)
        .map(|job| job.snapshot())
        .ok_or_else(|| command_error("overlay_job_not_found", job_id))
}

#[tauri::command]
pub fn cancel_overlay_export(
    job_id: u64,
    state: tauri::State<'_, Arc<crate::state::AppState>>,
) -> CommandResult<()> {
    let job = state
        .overlay_jobs
        .get(&job_id)
        .ok_or_else(|| command_error("overlay_job_not_found", job_id))?;
    job.cancelled.store(true, Ordering::Release);
    job.update(|progress| {
        if progress.status == "queued" || progress.status == "rendering" {
            progress.status = "cancelling".into();
        }
    });
    Ok(())
}

#[tauri::command]
pub fn open_overlay_folder(path: String) -> CommandResult<()> {
    let folder = PathBuf::from(path.trim());
    if !folder.is_dir() {
        return Err(command_error("invalid_output_path", "输出目录不存在"));
    }
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(&folder)
            .spawn()
            .map_err(|error| command_error("open_output_folder", error))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = folder;
        Err(command_error(
            "open_output_folder",
            "当前平台不支持打开输出目录",
        ))
    }
}

fn run_export(
    job_id: u64,
    request: OverlayExportRequest,
    state: Arc<crate::state::AppState>,
    job: Arc<OverlayJob>,
) -> Result<(), String> {
    let dataset = state
        .datasets
        .get(&request.dataset_id)
        .ok_or_else(|| "dataset_not_found".to_string())?;
    let channel_keys: Vec<String> = request
        .bindings
        .values()
        .filter(|key| !key.trim().is_empty())
        .cloned()
        .collect();
    if !request
        .bindings
        .get("speed")
        .is_some_and(|key| !key.trim().is_empty())
    {
        return Err("speed channel is required".into());
    }
    let measured_end = dataset
        .sample_range(&channel_keys)
        .map_err(|error| error.to_string())?
        .map(|(_, end)| end + 1. / request.fps as f64)
        .unwrap_or(0.);
    let source_end = dataset.manifest().meta.duration.max(measured_end);
    let anchors = request
        .anchors
        .iter()
        .map(|anchor| {
            overlay::parse_seconds(&anchor.video_time, request.timeline_fps).map(|video_seconds| {
                SyncAnchor {
                    data_seconds: anchor.data_seconds,
                    video_seconds,
                }
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let timeline_config = TimelineConfig {
        width: request.width,
        height: request.height,
        fps: request.fps,
        render_fps: request.render_fps,
        timeline_fps: request.timeline_fps,
        output_start: request.output_start,
        duration: request.duration,
        source_end,
        padding_head_seconds: request.padding_head_seconds,
        padding_tail_seconds: request.padding_tail_seconds,
        offset_seconds: request.offset_seconds,
        anchors,
    };
    let timeline = build_timeline(&timeline_config).map_err(|error| error.to_string())?;
    let indices = render_indices(timeline.frame_count, timeline.fps, timeline.render_fps)
        .map_err(|error| error.to_string())?;
    let sampler = load_sampler(&dataset, &channel_keys, request.max_gap_seconds)?;
    let binding_config = BindingConfig {
        slots: request.bindings.clone(),
        max_gap_seconds: request.max_gap_seconds,
    };
    let config = RenderConfig {
        width: timeline.width,
        height: timeline.height,
    };
    let render_context = load_render_context(&dataset, &request.bindings, config)?;
    let (final_path, partial_path) = output_paths(Path::new(&request.output_dir), request.fps)?;
    fs::create_dir_all(&request.output_dir).map_err(|error| error.to_string())?;
    let ffmpeg = find_ffmpeg()?;
    let start = Instant::now();
    job.update(|progress| {
        progress.status = "rendering".into();
        progress.total = indices.len();
        progress.output_frames = timeline.frame_count;
    });
    let result = write_parallel_chunks(
        &ffmpeg,
        &partial_path,
        &request,
        &indices,
        &sampler,
        &render_context,
        &timeline,
        &binding_config,
        config,
        &job,
        start,
    );
    if result.is_err() || job.cancelled.load(Ordering::Acquire) {
        let _ = fs::remove_file(&partial_path);
        return Err(if job.cancelled.load(Ordering::Acquire) {
            "cancelled".into()
        } else {
            result.err().unwrap_or_else(|| "render failed".into())
        });
    }
    job.update(|progress| {
        progress.status = "verifying".into();
    });
    verify_output(&ffmpeg, &partial_path, &timeline, &request)?;
    if job.cancelled.load(Ordering::Acquire) {
        let _ = fs::remove_file(&partial_path);
        return Err("cancelled".into());
    }
    fs::rename(&partial_path, &final_path).map_err(|error| error.to_string())?;
    let preview_index = timeline
        .head_frames
        .min(timeline.frame_count.saturating_sub(1));
    let preview_frame = sample_frame(&sampler, &timeline, preview_index, &binding_config)
        .map_err(|error| error.to_string())?;
    let preview_path = final_path.with_file_name("preview.png");
    render_overlay_png_with_context(&preview_path, &preview_frame, config, &render_context)
        .map_err(|error| error.to_string())?;
    let _ = fs::remove_file(partial_path.with_extension("log"));
    let _ = fs::remove_file(final_path.with_extension("log"));
    let _ = fs::remove_file(final_path.with_file_name("report.json"));
    let _ = fs::remove_file(final_path.with_file_name("progress.json"));
    job.update(|progress| {
        progress.status = "completed".into();
        progress.current = progress.total;
        progress.percent = 100.;
        progress.output_path = Some(final_path.display().to_string());
        progress.eta = 0.;
    });
    let _ = job_id;
    Ok(())
}

fn load_sampler(
    dataset: &DatasetCache,
    keys: &[String],
    max_gap_seconds: f64,
) -> Result<SeriesSampler, String> {
    let mut channels = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for key in keys {
        if !seen.insert(key.clone()) {
            continue;
        }
        let entry = dataset
            .manifest()
            .channels
            .iter()
            .find(|entry| entry.meta.key == *key)
            .ok_or_else(|| format!("channel not found: {key}"))?;
        let series = dataset.read_raw(key).map_err(|error| error.to_string())?;
        channels.push((
            key.clone(),
            entry.meta.unit.clone(),
            SampleSeries {
                times: series.times,
                values: series.values,
            },
        ));
    }
    SeriesSampler::from_channels(channels, max_gap_seconds).map_err(|error| error.to_string())
}

fn load_render_context(
    dataset: &DatasetCache,
    bindings: &HashMap<String, String>,
    config: RenderConfig,
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

enum ChunkEvent {
    Progress(usize),
    Done(Result<(), String>),
}

#[allow(clippy::too_many_arguments)] // FFmpeg 管线参数天然偏多
fn write_parallel_chunks(
    ffmpeg: &Path,
    output: &Path,
    request: &OverlayExportRequest,
    indices: &[usize],
    sampler: &SeriesSampler,
    context: &RenderContext,
    timeline: &overlay::OutputTimeline,
    bindings: &BindingConfig,
    config: RenderConfig,
    job: &OverlayJob,
    started: Instant,
) -> Result<(), String> {
    let worker_count = request.workers.clamp(1, 32).min(indices.len().max(1));
    let chunk_size = indices.len().div_ceil(worker_count);
    let multiplier = (timeline.fps / timeline.render_fps) as usize;
    let temp_dir = output
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("_overlay_chunks_{}", std::process::id()));
    fs::create_dir_all(&temp_dir).map_err(|error| error.to_string())?;
    let parts = indices
        .chunks(chunk_size.max(1))
        .enumerate()
        .map(|(chunk_id, chunk)| {
            let prior_render_frames = indices
                .chunks(chunk_size.max(1))
                .take(chunk_id)
                .map(|part| part.len() * multiplier)
                .sum::<usize>();
            let chunk_count = indices.len().div_ceil(chunk_size.max(1));
            let output_frames = if chunk_id + 1 < chunk_count {
                chunk.len() * multiplier
            } else {
                timeline.frame_count.saturating_sub(prior_render_frames)
            };
            (
                chunk.to_vec(),
                output_frames,
                temp_dir.join(format!("chunk_{chunk_id:03}.mov")),
            )
        })
        .collect::<Vec<_>>();
    let (event_tx, event_rx) = std::sync::mpsc::channel::<ChunkEvent>();
    let mut completed = 0usize;
    let mut rendered = 0usize;
    let mut last_update = Instant::now();
    let mut first_error = None;
    let result = std::thread::scope(|scope| -> Result<(), String> {
        for (chunk, output_frames, chunk_path) in &parts {
            let mut child = spawn_encoder(ffmpeg, chunk_path, request, timeline, *output_frames)?;
            let tx = event_tx.clone();
            scope.spawn(move || {
                let result = write_chunk(
                    &mut child, chunk, sampler, context, timeline, bindings, config, job, &tx,
                );
                let _ = tx.send(ChunkEvent::Done(result));
            });
        }
        drop(event_tx);
        while completed < parts.len() {
            match event_rx.recv_timeout(Duration::from_millis(100)) {
                Ok(ChunkEvent::Progress(delta)) => {
                    rendered += delta;
                    if last_update.elapsed() >= Duration::from_millis(100) {
                        update_progress(job, rendered, indices.len(), started);
                        last_update = Instant::now();
                    }
                }
                Ok(ChunkEvent::Done(result)) => {
                    completed += 1;
                    if let Err(error) = result {
                        first_error.get_or_insert(error);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if job.cancelled.load(Ordering::Acquire) {
                        update_progress(job, rendered, indices.len(), started);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    first_error.get_or_insert("render worker stopped".into());
                    break;
                }
            }
        }
        update_progress(job, rendered, indices.len(), started);
        if let Some(error) = first_error {
            return Err(error);
        }
        concatenate_chunks(ffmpeg, &parts, output)?;
        Ok(())
    });
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

#[allow(clippy::too_many_arguments)] // FFmpeg 管线参数天然偏多
fn write_chunk(
    child: &mut Child,
    indices: &[usize],
    sampler: &SeriesSampler,
    context: &RenderContext,
    timeline: &overlay::OutputTimeline,
    bindings: &BindingConfig,
    config: RenderConfig,
    job: &OverlayJob,
    events: &std::sync::mpsc::Sender<ChunkEvent>,
) -> Result<(), String> {
    let result = (|| {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "ffmpeg stdin unavailable".to_string())?;
        for (position, index) in indices.iter().copied().enumerate() {
            if job.cancelled.load(Ordering::Acquire) {
                return Err("cancelled".to_string());
            }
            let frame = sample_frame(sampler, timeline, index, bindings)
                .map_err(|error| error.to_string())?;
            let rgba = render_rgba_with_context(&frame, config, context)
                .map_err(|error| error.to_string())?;
            stdin.write_all(&rgba).map_err(|error| error.to_string())?;
            if position % 15 == 14 || position + 1 == indices.len() {
                let delta = if position % 15 == 14 {
                    15
                } else {
                    (position + 1) % 15
                };
                if delta > 0 {
                    let _ = events.send(ChunkEvent::Progress(delta));
                }
            }
        }
        drop(child.stdin.take());
        let status = child.wait().map_err(|error| error.to_string())?;
        if !status.success() {
            return Err(format!("ffmpeg chunk exited with {status}"));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}

fn update_progress(job: &OverlayJob, current: usize, total: usize, started: Instant) {
    let elapsed = started.elapsed().as_secs_f64();
    let speed = current as f64 / elapsed.max(0.001);
    let remaining = total.saturating_sub(current);
    job.update(|progress| {
        progress.current = current.min(total);
        progress.fps = speed;
        progress.elapsed = elapsed;
        progress.eta = remaining as f64 / speed.max(0.001);
        progress.percent = current.min(total) as f64 / total.max(1) as f64 * 100.;
    });
}

fn concatenate_chunks(
    ffmpeg: &Path,
    parts: &[(Vec<usize>, usize, PathBuf)],
    output: &Path,
) -> Result<(), String> {
    let list_path = output.with_file_name("overlay-concat-list.txt");
    let list = parts
        .iter()
        .map(|(_, _, path)| format!("file '{}'", path.display().to_string().replace('\\', "/")))
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(&list_path, format!("{list}\n")).map_err(|error| error.to_string())?;
    let log = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(output.with_extension("log"))
        .map_err(|error| error.to_string())?;
    let mut command = Command::new(ffmpeg);
    command
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
        ])
        .arg(&list_path)
        .args(["-c", "copy"])
        .arg(output)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    hide_console(&mut command);
    let status = command.status().map_err(|error| error.to_string())?;
    let _ = fs::remove_file(&list_path);
    if !status.success() {
        return Err(format!("ffmpeg concat exited with {status}"));
    }
    Ok(())
}

fn output_paths(dir: &Path, fps: u32) -> Result<(PathBuf, PathBuf), String> {
    let stem = if fps == 100 {
        "dashboard_100fps_alpha"
    } else {
        "dashboard_alpha"
    };
    let mut final_path = dir.join(format!("{stem}.mov"));
    if final_path.exists() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs();
        final_path = dir.join(format!("{stem}_{stamp}.mov"));
    }
    let partial = final_path.with_file_name(format!(
        "{}.partial.mov",
        final_path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(stem)
    ));
    Ok((final_path, partial))
}

fn find_ffmpeg() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("IMAGEIO_FFMPEG_EXE") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for candidate in [
            exe.parent().unwrap_or(Path::new(".")).join("ffmpeg.exe"),
            exe.parent()
                .unwrap_or(Path::new("."))
                .join("resources")
                .join("ffmpeg.exe"),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    let mut probe = Command::new("ffmpeg");
    probe
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut probe);
    if probe.status().is_ok() {
        return Ok(PathBuf::from("ffmpeg"));
    }
    Err(
        "找不到 FFmpeg。请设置 IMAGEIO_FFMPEG_EXE、将 ffmpeg.exe 放入程序目录，或加入 PATH。"
            .into(),
    )
}

fn spawn_encoder(
    ffmpeg: &Path,
    output: &Path,
    request: &OverlayExportRequest,
    timeline: &overlay::OutputTimeline,
    output_frames: usize,
) -> Result<Child, String> {
    let log_path = output.with_extension("log");
    let log = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&log_path)
        .map_err(|error| format!("创建 FFmpeg 日志失败: {error}"))?;
    let mut command = Command::new(ffmpeg);
    command.args([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgba",
        "-video_size",
        &format!("{}x{}", timeline.width, timeline.height),
        "-framerate",
        &timeline.render_fps.to_string(),
        "-i",
        "pipe:0",
        "-an",
        "-vf",
        &format!("fps={}", timeline.fps),
        "-frames:v",
        &output_frames.to_string(),
    ]);
    match request.codec.as_str() {
        "qtrle" => {
            command.args(["-c:v", "qtrle", "-pix_fmt", "argb"]);
        }
        "prores4444" => {
            command.args([
                "-c:v",
                "prores",
                "-profile:v",
                "4",
                "-pix_fmt",
                "yuva444p10le",
            ]);
        }
        other => return Err(format!("unsupported alpha codec: {other}")),
    }
    command
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));
    hide_console(&mut command);
    command
        .spawn()
        .map_err(|error| format!("启动 FFmpeg 失败: {error}"))
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}

fn find_ffprobe(ffmpeg: &Path) -> PathBuf {
    let sibling = ffmpeg.with_file_name(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    });
    if sibling.is_file() {
        sibling
    } else {
        PathBuf::from(if cfg!(windows) {
            "ffprobe.exe"
        } else {
            "ffprobe"
        })
    }
}

fn verify_output(
    ffmpeg: &Path,
    path: &Path,
    timeline: &overlay::OutputTimeline,
    request: &OverlayExportRequest,
) -> Result<(), String> {
    let ffprobe = find_ffprobe(ffmpeg);
    let mut probe = Command::new(&ffprobe);
    probe.args([
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames",
        "-of",
        "json",
    ]);
    probe.arg(path);
    hide_console(&mut probe);
    let output = probe
        .output()
        .map_err(|error| format!("启动 ffprobe 失败: {error}"))?;
    if !output.status.success() {
        return Err("ffprobe 无法读取导出视频".into());
    }
    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("解析 ffprobe 输出失败: {error}"))?;
    let stream = json
        .get("streams")
        .and_then(|streams| streams.as_array())
        .and_then(|streams| streams.first())
        .ok_or_else(|| "导出视频没有视频流".to_string())?;
    let width = stream
        .get("width")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    let height = stream
        .get("height")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as u32;
    if (width, height) != (timeline.width, timeline.height) {
        return Err(format!(
            "分辨率校验失败：得到 {width}×{height}，预期 {}×{}",
            timeline.width, timeline.height
        ));
    }
    let frame_rate = stream
        .get("r_frame_rate")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "缺少视频帧率".to_string())?;
    let mut rate_parts = frame_rate.split('/');
    let numerator = rate_parts
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.);
    let denominator = rate_parts
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(1.);
    if denominator == 0. || (numerator / denominator - timeline.fps as f64).abs() > 0.01 {
        return Err(format!(
            "帧率校验失败：得到 {frame_rate}，预期 {}",
            timeline.fps
        ));
    }
    let frames = stream
        .get("nb_read_frames")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if frames != timeline.frame_count {
        return Err(format!(
            "帧数校验失败：得到 {frames}，预期 {}",
            timeline.frame_count
        ));
    }
    let codec = stream
        .get("codec_name")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let pixel_format = stream
        .get("pix_fmt")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let alpha_ok = match request.codec.as_str() {
        "qtrle" => codec == "qtrle" && pixel_format == "argb",
        "prores4444" => codec.contains("prores") && pixel_format.starts_with("yuva444p"),
        _ => false,
    };
    if !alpha_ok {
        return Err(format!("透明编码校验失败：{codec} / {pixel_format}"));
    }
    verify_alpha_samples(ffmpeg, path, timeline)?;
    Ok(())
}

fn verify_alpha_samples(
    ffmpeg: &Path,
    path: &Path,
    timeline: &overlay::OutputTimeline,
) -> Result<(), String> {
    let mut times = Vec::new();
    if timeline.head_frames > 0 {
        times.push(timeline.head_frames as f64 / timeline.fps as f64 / 2.);
    }
    times.push(
        (timeline.head_frames as f64 + timeline.content_frames as f64 / 2.) / timeline.fps as f64,
    );
    if timeline.tail_frames > 0 {
        times.push(
            (timeline.head_frames + timeline.content_frames) as f64 / timeline.fps as f64
                + timeline.tail_frames as f64 / timeline.fps as f64 / 2.,
        );
    }
    for time in times {
        let mut sample = Command::new(ffmpeg);
        sample.args([
            "-v",
            "error",
            "-ss",
            &format!("{time:.9}"),
            "-i",
            path.to_string_lossy().as_ref(),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgba",
            "pipe:1",
        ]);
        hide_console(&mut sample);
        let output = sample
            .output()
            .map_err(|error| format!("启动 FFmpeg alpha 校验失败: {error}"))?;
        if !output.status.success() {
            return Err("FFmpeg 无法读取 alpha 校验帧".into());
        }
        let expected_bytes = timeline.width as usize * timeline.height as usize * 4;
        if output.stdout.len() < expected_bytes {
            return Err("alpha 校验帧尺寸不足".into());
        }
        let mut max_alpha = 0u8;
        for pixel in output.stdout[..expected_bytes].as_chunks::<4>().0 {
            max_alpha = max_alpha.max(pixel[3]);
        }
        let center = ((timeline.height / 2 * timeline.width + timeline.width / 2) * 4 + 3) as usize;
        if output.stdout[center] != 0 || max_alpha != 255 {
            return Err(format!(
                "透明度校验失败：{time:.3}s center={} max={max_alpha}",
                output.stdout[center]
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_names_keep_python_compatibility_and_partial_suffix() {
        let root = std::env::temp_dir().join("scut-overlay-export-tests");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let (one_hundred, partial) = output_paths(&root, 100).unwrap();
        assert_eq!(
            one_hundred.file_name().unwrap(),
            "dashboard_100fps_alpha.mov"
        );
        assert_eq!(
            partial.file_name().unwrap(),
            "dashboard_100fps_alpha.partial.mov"
        );
        let (sixty, _) = output_paths(&root, 60).unwrap();
        assert_eq!(sixty.file_name().unwrap(), "dashboard_alpha.mov");
        fs::write(&one_hundred, b"occupied").unwrap();
        let (next, _) = output_paths(&root, 100).unwrap();
        assert_ne!(next, one_hundred);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn job_starts_queued_and_can_be_cancelled() {
        let job = OverlayJob::new(42);
        assert_eq!(job.snapshot().status, "queued");
        job.cancelled.store(true, Ordering::Release);
        job.update(|progress| progress.status = "cancelling".into());
        assert_eq!(job.snapshot().status, "cancelling");
    }
}
