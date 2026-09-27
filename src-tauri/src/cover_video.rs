use crate::state::{command_error, CommandResult};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct CoverVideoDemoResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub async fn pick_cover_video_file() -> CommandResult<Option<String>> {
    let file = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_file_name("cover-video-demo.png")
            .add_filter("PNG", &["png"])
            .save_file()
    })
    .await
    .map_err(|error| command_error("dialog_task_failed", error))?;
    Ok(file.map(|path| path.display().to_string()))
}

#[tauri::command]
pub fn generate_cover_video_demo(path: String) -> CommandResult<CoverVideoDemoResult> {
    if path.trim().is_empty() {
        return Err(command_error("invalid_output_path", "输出路径不能为空"));
    }
    let report = cover_video::render_demo_png(&path)
        .map_err(|error| command_error("cover_video_render", error))?;
    Ok(CoverVideoDemoResult {
        path,
        width: report.width,
        height: report.height,
        bytes: report.bytes,
    })
}
