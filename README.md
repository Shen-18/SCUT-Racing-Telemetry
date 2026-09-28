# SCUT Racing Telemetry

SCUT Racing Telemetry is a Windows desktop application for importing, inspecting, and exporting motorsport telemetry. It is designed for fast analysis of large AiM and CSV recordings, with a dense analysis workspace for channel selection, synchronized plots, cursor values, statistics, timeline navigation, and GPS track review.

## Features

- Import AiM `.XRK` recordings and telemetry `.CSV` files.
- Keep a local content-addressed cache so imported files can be reopened quickly.
- Browse records by date, vehicle, driver, and session metadata.
- Select multiple channels and render synchronized charts with shared time and cursor alignment.
- Use pyramid previews while navigating and raw samples for detailed inspection.
- Preserve missing telemetry as gaps instead of inventing connecting segments.
- Inspect min/max/average statistics for the active time window.
- Review GPS track data with zoom and pan controls.
- Export selected records to CSV.
- Open the original source file from the library view.
- Light and dark themes, resizable analysis columns, and persistent window state.

## Technology stack

### Desktop shell

- **Tauri 2** — Windows desktop packaging and native commands.
- **Rust** — file import, cache management, raw sample access, statistics, export, and AiM DLL integration.
- **WebView2** — renders the React interface on Windows.

### Frontend

- **React 18** with TypeScript.
- **Vite 6** for development and production builds.
- **uPlot** for high performance time-series rendering.
- **Zustand** for application state.
- **Tailwind CSS** and project QSS/CSS tokens for layout and theming.
- **Vitest** and Testing Library utilities for frontend tests.

### Rust workspace

- `telemetry-core` — channel models, alignment, statistics, pyramids, and CSV utilities.
- `cache-core` — persistent dataset metadata, raw channel storage, and cached window frames.
- `aim-ffi` — FFI bridge for the AiM XRK DLL.
- `csv-parser` — CSV telemetry parsing.
- `telemetry-ipc` — validated binary frame encoding and decoding between Rust and the frontend.
- `cover-video` — cover-video rendering support.
- `src-tauri` — Tauri commands and application wiring.

## Repository layout

```text
src/                    React application and frontend tests
src-tauri/              Tauri commands and desktop entry point
crates/telemetry-core/  Shared telemetry algorithms and models
crates/cache-core/      Persistent cache and raw sample access
crates/aim-ffi/         AiM DLL integration
crates/csv-parser/      CSV import support
crates/telemetry-ipc/   Binary IPC frame contract
config/frontend/        Vite, TypeScript, and ESLint configuration
Data/                   Development fixtures and application assets
tests/                  Tooling, golden data, and integration fixtures
```

## Requirements

- Windows 10 or later.
- Node.js with pnpm 11.
- Rust stable toolchain through `rustup`.
- Microsoft WebView2 Runtime.
- The AiM XRK DLL for XRK import. The development repository includes a test DLL under `TestMatLabXRK/DLL-2022/`.

## Development

Install JavaScript dependencies:

```powershell
pnpm install
```

Run the web UI:

```powershell
pnpm dev:web
```

Run the Tauri development application:

```powershell
pnpm dev
```

The application looks for the AiM DLL at `TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll` by default. Override paths when needed:

```powershell
$env:SCUT_AIM_DLL = "C:\path\to\MatLabXRK-2022-64-ReleaseU.dll"
$env:SCUT_CACHE_ROOT = "C:\path\to\telemetry-cache"
```

## Verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
cargo check --workspace
```

## Production build

Build the frontend and Rust executable without creating an installer:

```powershell
.\build.ps1
```

Create the Windows NSIS installer:

```powershell
pnpm tauri build
```

The generated executable and installer are written below `target/release/` and `target/release/bundle/nsis/`.

The repository also provides `build.cmd` for a guided release executable build and `start.cmd` for launching the local executable.

## Data and cache model

Imported recordings are identified by SHA-256 source identity and stored in the local cache. Raw channels are retained separately from metadata and optional pyramid frames. Window requests use a validated binary frame containing timestamps, minimums, maximums, and request generation. A generation value lets the frontend discard stale responses while the user is dragging or zooming.

Missing samples remain non-finite in the frame contract and are rendered as chart gaps. Cursor values are read from the raw channel data and are shown only when a finite sample is available at the requested time.

## License and project status

This repository is maintained for SCUT Racing telemetry analysis. Add the project license and release policy here when they are finalized.
