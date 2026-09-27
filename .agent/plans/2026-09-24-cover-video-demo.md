# Cover Video Demo Implementation Plan

**Goal:** Produce one transparent overlay PNG from Rust and expose it through a consistent Cover Video page in the Tauri application.

**Architecture:** `cover-video` owns a small rendering interface and all pixel/layout details. A thin Tauri adapter writes the PNG and returns bytes for preview; React only manages navigation, save-path selection, and preview state.

**Tech Stack:** Rust workspace crate, `tiny-skia`, `ab_glyph`, embedded PNG/TTF assets, Tauri v2 command, React 18, Zustand, existing CSS variables.

**Spec:** `.agent/specs/2026-09-24-cover-video-demo-design.md`

## Global Constraints

- Output is one `2560×1440` straight-alpha PNG with a transparent canvas.
- The first frame uses fixed demo values and does not read a dataset.
- Tauri remains the only backend boundary imported by frontend code.
- Existing analysis and export flows remain unchanged.
- Do not run the test suite in this pass; use `cargo check`, TypeScript typecheck, and diff checks only.

### Task 1: Add the Rust renderer crate

**Files:**
- Create: `crates/cover-video/Cargo.toml`
- Create: `crates/cover-video/src/lib.rs`
- Create: `crates/cover-video/src/layout.rs`
- Create: `crates/cover-video/src/render.rs`
- Create: `crates/cover-video/assets/logo_white.png`
- Create: `crates/cover-video/assets/Formula1-Display-Regular.ttf`
- Create: `crates/cover-video/assets/Formula1-Display-Bold.ttf`
- Modify: `Cargo.toml`

**Interface:** `cover_video::render_demo_png(path) -> Result<RenderReport, RenderError>`.

Implement the fixed frame in Rust by translating the default widgets from `aim-telemetry-overlay/scripts/widgets.py`. Use the exported demo only for visual comparison; do not copy or load its PNG at runtime. Keep the crate independent of Tauri and React.

### Task 2: Add the Tauri adapter and command registration

**Files:**
- Create: `src-tauri/src/cover_video.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`

Add a save-file command and a generation command. The generation command creates the parent directory, invokes the crate, reads the written PNG bytes, and returns `{ path, width, height, bytes }`.

### Task 3: Add the Cover Video frontend seam

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/state/appStore.ts`
- Create: `src/components/CoverVideoView.tsx`
- Modify: `src/components/AppShell.tsx`

Add the view union and navigation handler, enable the existing `TELEMETRY VIDEO` tab, and build a page with the current dark/F1 tokens, output chooser, generate button, status text, and checkerboard preview.

### Task 4: Verify the integration surface

Run `cargo check -p cover-video -p scut-racing-telemetry`, `pnpm typecheck`, and `git diff --check`. Inspect the generated diff and record any environment limitation without claiming product tests passed.
