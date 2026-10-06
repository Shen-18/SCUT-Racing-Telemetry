# Overlay Video Export Parity Specification

## Goal

把 `D:/Desktop/aim-telemetry-overlay` 的实际透明视频导出流程迁移到当前 Rust/Tauri Overlay 工作台，保持原软件的时间轴、同步、通道绑定、帧采样、透明编码、进度和校验语义一致。当前工作台保留现有选择记录入口；导出使用已经导入到 `cache-core` 的原始遥测缓存，不再依赖 Python sidecar。

## Parity contract

- 默认输出时间线为 `fps=100`；渲染采样为 `render_fps=20`，必须整除输出帧率，等价于原 Python `render_indices` 的步长。`fps`、`render_fps`、`width`、`height` 必须是导出请求和 Rust renderer 的配置字段，100 FPS 与 2560×1440 只是默认值，不能写死在编码器、时间线或布局缩放中。
- `sync` 保持原语义：`video_seconds = data_seconds * scale + offset_seconds`；支持零、一、两个锚点；锚点和 offset 互斥；支持 `output_start` 与显式 `duration`。
- `padding_seconds.head/tail` 按 `round(seconds * fps)` 生成头尾帧；头尾保留 HUD 布局，数值为空，透明采样规则与原 Python 校验一致。
- 通道绑定沿用原 `BIND_SLOTS`、候选名、显式不绑定、单位换算、重复时间戳取平均和 `max_gap_seconds` 断点规则；速度没有匹配时必须报错，不能静默改用 GPS 速度。
- Rust renderer 使用同一套布局、文字、颜色、透明度、轨迹和电机/踏板/G-force 数据；画布尺寸从 `width`/`height` 读取，默认 2560×1440，并按基准画布比例缩放布局。尺寸必须保持正偶数且满足当前布局的 16:9 约束。
- 输出文件名与编码保持一致：默认 100 FPS 使用 `dashboard_100fps_alpha.mov`，其他帧率使用 `dashboard_alpha.mov`；帧率变化后文件名和报告都从实际配置计算。默认支持 QTRLE ARGB，并保留 ProRes 4444 alpha 配置。
- 进度指标沿用原字段：`current`、`total`、`output_frames`、`fps`、`elapsed`、`eta`、`percent`；取消时杀掉编码器和渲染任务并清理临时文件。
- 完成后执行透明通道、分辨率、帧率、帧数和头尾透明帧校验，失败不能替换最终文件。

## Scope boundary

本阶段只迁移原导出流程和同步语义。不会生成合成后的实车视频，也不会改变 Database、分析图表或记录索引行为。预览继续使用同一套渲染帧，但最终目标是透明 MOV。

## Module seams

- `crates/overlay/src/timeline.rs`: 帧率校验、时间码解析、同步锚点、输出 timeline 和 padding。
- `crates/overlay/src/bindings.rs`: 通道候选、单位转换、插值/断点规则和绑定后的逐帧数据。
- `crates/overlay/src/frame.rs`: renderer 输入模型，包含每一帧 HUD 需要的数值、route 和 active 状态。
- `crates/overlay/src/render.rs`: 与原 Python widgets/hud 对齐的透明 RGBA 帧绘制。
- `src-tauri/src/overlay.rs`: 保留 PNG 预览入口并复用可配置 renderer。
- `src-tauri/src/overlay_export.rs`: 从 `DatasetCache` 读取 raw series，创建渲染任务，管理 FFmpeg、临时文件、并行渲染、取消和校验。
- `src/api/client.ts`: 只暴露语义化的 start/progress/cancel/result API。
- `src/components/OverlayView.tsx`: 将当前 PNG demo 按钮替换为原工作台的输出目录、编码选项、预览、进度、速度、耗时、ETA、取消和打开目录流程。

## Runtime dependency

Rust 负责时间线、采样、布局和 RGBA 帧生成；MOV 封装仍由本地 FFmpeg 完成。运行时依次查找 `IMAGEIO_FFMPEG_EXE`、程序目录、`resources` 目录和 PATH，并要求同一套构建提供 `ffmpeg.exe` 与 `ffprobe.exe`。这样可以保持不依赖 Python sidecar，同时避免把 100 MB 级别的 GPL 二进制强行提交到源码仓库。

## Acceptance criteria

1. 用原 Python 测试 CSV 和同一绑定配置运行 Rust 导出，报告中的 width、height、fps、render_fps、frames、duration、padding、alignment 与 Python 一致。
2. 使用至少一组非默认尺寸/帧率配置（例如 1920×1080、60→20 FPS）确认 renderer、timeline、FFmpeg 参数和报告都读取配置，没有依赖默认常量。
3. 同一输入的固定采样帧在布局和透明像素上通过 Rust golden image/alpha 检查。
4. 导出 MOV 可被 ffprobe 识别为配置要求的透明编码，帧数、分辨率、fps 与报告一致。
5. 中途取消不会留下可被误认作完成的最终 MOV；重新导出可以覆盖或生成带时间戳的新文件。
6. Overlay 工作台可以看到实时进度、速度、耗时、ETA 和最终路径；错误会显示在工作台，不会跳回 detail。
