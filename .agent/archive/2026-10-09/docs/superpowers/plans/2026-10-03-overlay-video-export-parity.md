# Overlay Video Export Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将原 Python Overlay 的真实透明视频导出流程迁移到 Rust/Tauri，并保持时间轴同步、通道采样、编码、进度和校验一致。

**Architecture:** 以 `cache-core` 的 raw series 作为唯一数据源，在 `crates/overlay` 中拆出时间线、绑定、逐帧模型和可配置画布；Tauri 只负责读取缓存、启动可取消的渲染/FFmpeg 管线和向前端推送进度。`width`、`height`、`fps`、`render_fps`、编码器和同步参数从 `OverlayExportRequest` 传入，默认值与 Python 一致，布局按基准 2560×1440 进行比例缩放。前端 Overlay 工作台复用当前记录选择页，操作台改为原 Python 工作台的真实导出状态机。

**Tech Stack:** Rust 2021, Tauri 2, `cache-core`, `tiny-skia`, `ab_glyph`, FFmpeg process/codec, React, Zustand, Vitest, Rust unit tests.

**Spec:** `docs/superpowers/specs/2026-10-03-overlay-video-export-parity.md`

## Global Constraints

- 不引入 Python sidecar；导出逻辑、同步和采样全部由 Rust 执行。
- 不改变 Database、分析图表、记录索引和现有 `openDataset` 行为。
- 未明确匹配的速度通道必须报错，不能自动回退 GPS 速度。
- 只有通过透明编码和帧数校验后才允许发布最终 MOV。
- FFmpeg 作为受控本地编码器使用，必须支持 Windows 无控制台窗口、日志文件和取消清理。
- 分辨率和帧率必须保留为公开导出配置；禁止在 renderer、timeline 或 FFmpeg 参数中复制默认值。

---

### Task 1: Freeze Python parity fixtures

**Files:**
- Create: `crates/overlay/tests/parity_fixtures.rs`
- Create: `crates/overlay/tests/fixtures/parity_case.json`
- Modify: `docs/superpowers/specs/2026-10-03-overlay-video-export-parity.md`

**Interfaces:**
- Produces deterministic input metadata, sync anchors, padding and expected timeline values consumed by Tasks 2–4.

- [ ] **Step 1: Write the failing fixture assertions**

```rust
assert_eq!(timeline.output_frames, 1200);
assert_eq!(timeline.head_frames, 500);
assert_eq!(timeline.tail_frames, 500);
assert_eq!(timeline.frame_time(500), 5.0);
```

- [ ] **Step 2: Run `cargo test -p overlay --test parity_fixtures` and confirm the timeline API is not present.**

- [ ] **Step 3: Store a small deterministic fixture with two sync anchors, 100 FPS output, 20 FPS render sampling, 5-second head/tail padding, and one channel gap.**

- [ ] **Step 4: Keep the expected values generated from the original Python formulas in the test comments; do not copy generated video bytes into the repository.**

- [ ] **Step 5: Run the fixture test again after each timeline/binding implementation task.**

### Task 2: Port synchronization and timeline semantics

**Files:**
- Create: `crates/overlay/src/timeline.rs`
- Modify: `crates/overlay/src/lib.rs`
- Test: `crates/overlay/tests/parity_fixtures.rs`

**Interfaces:**
- Produces `TimelineConfig { width, height, fps, render_fps, ... }`, `Alignment`, `OutputTimeline`, `parse_seconds`, `solve_alignment`, `build_timeline`, and `render_indices`.
- `TimelineConfig` 的默认值为 `width=2560`、`height=1440`、`fps=100`、`render_fps=20`，但所有计算使用实例字段。

- [ ] **Step 1: Implement `parse_seconds(value: &str, timeline_fps: f64) -> Result<f64, TimelineError>` for decimal seconds, `HH:MM:SS`, `HH:MM:SS:FF`, and the same validation errors as Python.**

- [ ] **Step 2: Implement `solve_alignment(anchors, offset_seconds, timeline_fps) -> Result<Alignment, TimelineError>` with zero/one/two anchors and mutual exclusion.**

- [ ] **Step 3: Implement output frame count, `head_frames`, `content_frames`, `tail_frames`, video time, data time and `overlay_active` exactly using `ceil(length * fps - 1e-8)` and rounded padding frames. Validate positive even `width`/`height`, positive fps, and exact `fps % render_fps == 0`; do not use renderer constants.**

- [ ] **Step 4: Implement `render_indices(frame_count, output_fps, render_fps)` with exact divisibility validation and Python-equivalent step.**

- [ ] **Step 5: Run the fixture and unit tests; expected result is PASS for anchor scale/offset, padding and render indices.**

### Task 3: Port channel binding and sampling

**Files:**
- Create: `crates/overlay/src/bindings.rs`
- Create: `crates/overlay/src/frame.rs`
- Modify: `crates/overlay/src/lib.rs`
- Modify: `crates/cache-core/src/raw.rs` only if a bulk read helper is needed
- Test: `crates/overlay/tests/parity_fixtures.rs`

**Interfaces:**
- Produces `BindingConfig`, `ResolvedBindings`, `SeriesSampler`, `OverlayFrame`, `resolve_candidate`, `interpolate_series`, and `sample_frame`.

- [ ] **Step 1: Add tests for exact normalized candidate matching, token-set fallback, duplicate timestamp averaging, speed/G/torque/RPM unit conversion, and `max_gap_seconds` returning NaN.**

- [ ] **Step 2: Read each selected raw channel once through `DatasetCache::read_raw`, group equal timestamps by mean, and expose a binary-search sampler rather than calling `read_cursor_values` for every frame.**

- [ ] **Step 3: Implement the Python channel map, alias map, motor active policy, duplicate torque rejection and “speed missing” hard error.**

- [ ] **Step 4: Implement `sample_frame(timeline_frame)` so padding frames keep the layout active but return empty numeric values, while content frames map `data_time = (video_time - offset) / scale`.**

- [ ] **Step 5: Run parity tests against the fixture, including samples immediately before/after a gap and at both padding boundaries.**

### Task 4: Make the Rust renderer consume real frames

**Files:**
- Modify: `crates/overlay/src/layout.rs`
- Modify: `crates/overlay/src/render.rs`
- Create: `crates/overlay/tests/render_golden.rs`

**Interfaces:**
- `RenderConfig { width, height, base_width: 2560, base_height: 1440, ... }` is passed to every renderer call.
- `render_png(path, frame: OverlayFrame, config: &RenderConfig)` remains the single-frame API used by preview.
- Add `render_rgba(frame: &OverlayFrame, config: &RenderConfig) -> Result<Vec<u8>, RenderError>` for video encoding.

- [ ] **Step 1: Add renderer tests asserting that changing speed, throttle, G-force and torque changes the corresponding pixels while transparent padding remains fully transparent.**

- [ ] **Step 2: Replace `DemoFrame::sample()` reads with `OverlayFrame` values while preserving the existing geometry and font assets; derive the canvas and scale from `RenderConfig`, with 2560×1440 as the baseline only.**

- [ ] **Step 3: Port the remaining Python HUD semantics used by `widgets.py`/`hud.py`: route trail, timing card, active/blank state, labels, unit conversion and layout opacity. All geometry uses the config-derived scale so 16:9 resolutions remain aligned.**

- [ ] **Step 4: Keep the current demo API as a wrapper around `OverlayFrame::sample()` so existing PNG tests remain valid.**

- [ ] **Step 5: Run `cargo test -p overlay` and compare the fixture frame dimensions, alpha coverage and key pixel samples.**

### Task 5: Add an FFmpeg export pipeline with cancellation

**Files:**
- Create: `src-tauri/src/overlay_export.rs`
- Modify: `src-tauri/src/overlay.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml` if a process/parallelism helper is required
- Test: `src-tauri/src/overlay_export.rs`

**Interfaces:**
- `start_overlay_export(request: OverlayExportRequest) -> OverlayJobId`
- `overlay_export_status(job_id: u64) -> OverlayProgress`
- `cancel_overlay_export(job_id: u64) -> ()`
- `open_overlay_output(path) -> ()`

- [ ] **Step 1: Add tests for output filename selection, QTRLE/ProRes arguments, render-frame allocation, and cancellation state transitions.**

- [ ] **Step 2: Implement FFmpeg discovery (`IMAGEIO_FFMPEG_EXE`, PATH, app resource directory) and write a `.log` beside temporary output; Windows processes use `CREATE_NO_WINDOW`.**

- [ ] **Step 3: Implement a bounded worker pipeline that renders sampled RGBA frames in order and feeds FFmpeg at configured `render_fps` with `-vf fps=<output_fps>` and exact output frame count; pass configured width/height to `-video_size` and never assume 2560×1440 or 100 FPS.**

- [ ] **Step 4: Use a `.partial.mov` path and atomic rename only after FFmpeg exits successfully; on cancel/error kill the process and remove temporary files.**

- [ ] **Step 5: Emit progress fields matching the Python worker and expose the status through Tauri commands.**

### Task 6: Port verification and report artifacts

**Files:**
- Create: `crates/overlay/src/verify.rs`
- Modify: `src-tauri/src/overlay_export.rs`
- Test: `crates/overlay/tests/verify.rs`

**Interfaces:**
- Produces `verify_transparent_mov(path, report) -> Result<VerificationReport, VerifyError>`.

- [ ] **Step 1: Add tests for unsupported codec, frame count mismatch, resolution/fps mismatch, and non-transparent padding.**

- [ ] **Step 2: Implement ffprobe metadata parsing and raw RGBA sample checks for head/middle/tail using the same sampling times as Python.**

- [ ] **Step 3: Write `resolved-config.json`, `report.json`, `progress.json`, and `verification.json` next to the output, matching the original names and fields.**

- [ ] **Step 4: Publish the final MOV only after verification passes; surface verification errors in the workbench.**

### Task 7: Replace the demo button with the real workbench flow

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/components/OverlayView.tsx`
- Modify: `src/components/OverlayView.test.tsx`
- Modify: `src/state/appStore.ts` only if job state needs a store boundary

**Interfaces:**
- Frontend request type mirrors `OverlayExportRequest`: record dataset id, binding map, fps, render fps, padding, sync config, codec, workers and output directory.

- [ ] **Step 1: Add UI tests for start, live progress, cancel, completed output and error states.**

- [ ] **Step 2: Replace the single PNG “开始 Overlay 渲染” call with start/status polling or Tauri event subscription.**

- [ ] **Step 3: Add the original controls: output directory, worker count, output width/height, output FPS, render FPS, codec, head/tail padding, sync offset/anchors, preview update, output folder and cancel. Keep the Python defaults prefilled, but leave width/height/fps editable for later use.**

- [ ] **Step 4: Keep the existing binding panel and send its resolved values in the export request.**

- [ ] **Step 5: Show the Python-equivalent metrics and final verification result without navigating to detail.**

### Task 8: End-to-end parity verification and build

**Files:**
- Create: `tests/overlay-parity.ps1`
- Modify: `docs/superpowers/specs/2026-10-03-overlay-video-export-parity.md`

- [ ] **Step 1: Run the Rust exporter on the deterministic fixture and save the report artifacts outside Git.**

- [ ] **Step 2: Run the original Python exporter on the same fixture and compare width, height, fps, render_fps, timeline/report fields; repeat with the non-default 1920×1080, 60→20 FPS configuration.**

- [ ] **Step 3: Run frontend tests, Rust tests, typecheck, lint and Tauri release build.**

- [ ] **Step 4: Verify the generated installer and executable paths before reporting completion.**
