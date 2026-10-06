# SCUT Racing Telemetry architecture review

> Initial read-only repository inventory captured 2026-09-24. The working tree was already dirty before this report; the current Overlay demo is recorded in the addendum below.

## Demo addendum (2026-09-24)

The first Overlay vertical slice is now present:

- `crates/overlay` is a standalone Rust renderer using `tiny-skia`, `ab_glyph`, and `png`. It embeds the SCUT logo and Formula 1 fonts and emits one transparent `2560×1440` RGBA PNG from a fixed demo frame.
- `src-tauri/src/overlay.rs` is the adapter seam. It owns the save dialog, file writing, and the `{ path, width, height, bytes }` command result; pixel layout stays in the crate.
- `src/components/OverlayView.tsx` is a new `overlay` view reached from the former disabled `OVERLAY` navigation item. It previews the returned bytes over a checkerboard using the existing F1/SCUT visual tokens.
- The demo deliberately does not read a dataset, encode MOV, or compose with a camera video. Those are follow-up stages after the renderer and entry point are accepted.

## Scope and repository state

- `main` is checked out at `8e7b4db` (`origin/main` points to the same commit). `origin/V0` is a separate legacy tree with `code/`, `docs/`, and `migrate-v1/`; it is not part of the current main-tree build.
- The current checkout has many pre-existing tracked modifications (Rust crates, `src-tauri`, and frontend files). Treat diffs as caller-owned; this report does not attempt to reconcile them.
- `.agent/` contains the tracked ADRs/contracts and is the authoritative design source. The report is stored at `.agent/architecture-review.md` so it follows the workspace layout rule that root `docs/` is not used.

## Current top-level layout

| Path | Role | Status |
|---|---|---|
| `crates/` | Rust domain, cache, import, IPC, and placeholder crates | tracked |
| `src-tauri/` | Tauri v2 desktop host and command façade | tracked |
| `src/` | React 18 frontend, Zustand state, API boundary, charts/panels | tracked |
| `config/frontend/` | Vite, TypeScript, ESLint, Tailwind configuration | tracked |
| `tests/` | Rust golden fixture plus tooling/dependency guard scripts | tracked |
| `Data/` | XRK sample data and app artwork | tracked; source fixtures |
| `TestMatLabXRK/` | Vendor AiM MatLabXRK DLL, dependent DLLs, headers, C++ sample, XRK fixtures | tracked; integration-test dependency |
| `design-demos/` | Design specification and assets | tracked; demo HTML/fonts are ignored |
| `target/`, `node_modules/`, `.pnpm-store/` | Rust/frontend build and package-store output | ignored/generated |
| `.cache/` | Default application cache plus local recovery/temp artifacts | ignored, but contains imported datasets and copied source files |
| `.agent/` | Tracked ADRs/contracts/evidence conventions; ignored generated evidence also exists | mixed |

## Rust workspace and dependency direction

`Cargo.toml` declares ten workspace members:

1. `telemetry-core`
2. `cache-core`
3. `aim-ffi`
4. `csv-parser`
5. `telemetry-store`
6. `telemetry-ipc`
7. `overlay`
8. `src-tauri` (package `scut-racing-telemetry`)
9. `crates/migrate-v1`
10. `tests/golden-tests`

Observed dependency roles:

- **`telemetry-core`** (`src/models.rs`, `csv_io.rs`, `downsample.rs`, `gps.rs`, `pyramid.rs`, `stats.rs`): pure in-memory telemetry model/algorithms; `#![forbid(unsafe_code)]`. `TelemetryDataset`, `ChannelMeta`, `ChannelSeries`, session/lap metadata, CSV I/O, downsampling, GPS derivation, stats, and pyramid construction are exported from `src/lib.rs`.
- **`aim-ffi`**: `libloading` bridge to the vendor MatLabXRK DLL. Its actor owns DLL work and depends only on `telemetry-core`; `TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll` is the default runtime path.
- **`csv-parser`**: parses the canonical telemetry CSV format into `telemetry-core` values.
- **`cache-core`**: persistent metadata-first cache over `datasets/<sha256>/`. It writes `manifest.json`, raw channel blobs, and pyramid blobs with checksums/atomic publication; states progress from metadata through raw/pyramid to `Ready`/`Failed`. It exposes range/overlap, cursor, raw, and window-frame reads.
- **`telemetry-ipc`**: shared DTOs, import-stage transitions, command errors, JSON helpers, and `SXK1` binary frame encode/decode. It depends on `telemetry-core`; frontend types mirror these structures in `src/api/types.ts` and `src/api/frame.ts`.
- **`overlay`**: independent transparent PNG renderer. It embeds the overlay assets and exposes a fixed demo-frame renderer; it has no telemetry or Tauri dependency.
- **`src-tauri`**: host/orchestrator. `AppState` owns `CacheRoot`, one `AimActor`, open dataset handles, import jobs, and temporary ZIP directories. `imports.rs` performs XRK/CSV/ZIP import, publishes metadata first, then raw and pyramids. `main.rs` registers import, dataset, window, stats, export, record, comments/layout, and cache commands.
- **`telemetry-store`**: foundation crate only (`src/lib.rs` is a documentation comment). It is listed as a Tauri dependency but has no observed Rust imports in `src-tauri`; treat as dormant scaffolding.
- **`migrate-v1`**: workspace member with only `println!("migrate-v1 placeholder")`; no migration implementation or call sites.
- **`golden-tests`**: one fixture identity/SQLite-header test in `tests/golden-tests/src/lib.rs`; it is evidence scaffolding, not a numerical telemetry golden suite.

`config/contracts/dependencies.json` and `tests/tooling/verify_dependencies.py` freeze the allowed member set, dependency edges, versions, and frontend IPC boundary. The guard rejects reverse crate edges, unallowlisted packages, direct Tauri imports outside `src/api/client.ts`, and Tauri major/minor drift.

## Frontend, Tauri, and IPC relationship

- `src/main.tsx` mounts `App`; `App` renders `AppShell`. `src/state/appStore.ts` owns dataset/import/window/cursor/theme state. Panels (`ChannelTree`, `PlotStack`, `TrackMapPanel`, `StatsPanel`, `LapsPanel`, `CommentsPanel`) consume this state.
- `src/api/client.ts` is the only frontend module importing `@tauri-apps/api`; it wraps all commands (`start_import`, `open_dataset`, `window_series`, cache status/purge, export, records, comments/layout, etc.). `workflow.ts` coordinates import polling, metadata opening, prioritized channels, and generation-checked frames.
- Tauri commands in `src-tauri/src/main.rs` call `AppState`/cache/import modules. Window queries return `telemetry-ipc` frame bytes; the JS decoder validates `SXK1` and generation before updating charts. Full-resolution raw reads remain an explicit backend operation; normal plotting uses pyramid windows bounded by pixel budget.
- `src-tauri/tauri.conf.json` and capabilities define the Tauri v2 shell. `config/frontend/vite.config.ts` emits frontend output to `target/frontend`; `pnpm` scripts provide typecheck/lint/Vitest/build and `tests/tooling/check.ps1` adds cargo fmt/clippy/test, frontend checks, build, and golden suite.

## Cache and test relationships

- Default runtime paths are selected in `src-tauri/src/main.rs`: AiM DLL defaults to `TestMatLabXRK/...dll`; cache defaults to repository `.cache` unless `SCUT_AIM_DLL`/`SCUT_CACHE_ROOT` overrides are set. This differs from ADR `.agent/adr/0004-pyramid-cache.md`, which describes an AppData cache default; confirm intended product behavior before relocating.
- Current `.cache` is populated (`datasets/`, `manifest.json`/channel blobs, copied `source.xrk`, plus recovery/temp directories). Deleting it removes imported cache records and local recovery artifacts, while source files under `Data/` remain.
- Unit/integration coverage exists in each active crate, `src-tauri` import/export/state tests, and frontend `*.test.ts(x)` files. `aim-ffi` tests require the real DLL/XRK fixtures on Windows. Dependency guard tests use temporary copies and are designed not to mutate the live repo.

## Cleanup classification

### Generally safe after stopping builds/tests

These paths are ignored/generated and can be regenerated, subject to no active process using them:

- `target/` (about 11 GB Rust/Tauri build output; includes `target/frontend`)
- `node_modules/` (about 148 MB; restore with `pnpm install`)
- `.pnpm-store/` (about 183 MB package cache; reinstall is slower)
- `debug_top.log`, `tests/tooling/__pycache__/`, ignored design-demo HTML/fonts, and other ignored transient logs
- `.agy-staff/`, `.workbuddy/`, and ignored `.agents/` contents when no agent/session is using them

### Require confirmation or backup

- `.cache/`: application data, imported datasets, copied source files, and recovery artifacts. Cleanup is rebuildable only if original source files are available and re-import is acceptable.
- `Data/` and `TestMatLabXRK/`: tracked XRK/XTZ fixtures, vendor DLLs/dependencies, headers, and sample project; required by integration tests/runtime.
- `tests/` fixtures/golden files and `.agent/` ADR/contracts/evidence: tracked verification/design evidence.
- `.git/`, `Cargo.lock`, `pnpm-lock.yaml`, `src-tauri/gen/`, and source/config directories: do not delete as cleanup; they define history, reproducible dependency resolution, generated Tauri schemas, or product behavior.

## Key conclusions

1. The main architecture is present and coherent: pure `telemetry-core` → source adapters (`aim-ffi`, `csv-parser`) → `cache-core` persistence → `telemetry-ipc` DTO/frame contract → Tauri commands → React client/store/charts.
2. `telemetry-store` and `migrate-v1` are present as workspace placeholders, not active runtime modules; `golden-tests` is a minimal foundation check.
3. The most consequential architecture discrepancy is the cache default (`.cache` in code vs AppData in ADR). Resolve that product decision before moving or cleaning cache data.
4. The checkout is not clean; this review intentionally leaves all pre-existing source modifications untouched.
