# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
# Run the app (development)
cd code && python -m scut_telemetry

# Run all tests
cd code && python -m pytest tests/ -v

# Quick smoke test for XRK DLL parsing
cd code && python -m scut_telemetry --smoke-xrk <path_to_xrk_file>

# Full quality gate (test → import check → compileall → build)
cd code && .\check.ps1

# Install dependencies
cd code && python -m pip install -r requirements.txt

# Build standalone executable
cd code && .\build.ps1
# Output: code/dist/SCUTRacingTelemetry/SCUTRacingTelemetry.exe
```

## Project Overview

SCUT Racing Telemetry is a Windows desktop app for analyzing AiM data logger telemetry files (.xrk/.xrz/.csv). Built with PySide6 (Qt6) + pyqtgraph, targeting Formula Student racing teams.

### Key Architecture Decisions

- **XRK parsing via official AiM DLL** — uses `ctypes` to call `MatLabXRK-*-64-ReleaseU.dll` rather than reverse-engineering the binary format. See `xrk_dll.py` for the DLL bridge.
- **20 Hz resampling** — raw sensor data arrives at irregular timestamps; all channels are linearly interpolated to a uniform 20 Hz time axis.
- **Modular UI** — `ui/main_window.py` (~700 lines) handles orchestration only. Nine sibling modules split plotting, timeline, channel list, track panel, dialogs, workers, formatting, comments panel, and library home into focused files under `ui/`.
- **Dual-file comparison** — overlay and split modes, with cross-correlation-based auto offset estimation in `analyzer.py:estimate_offset()`.
- **Background workers** — file parsing, auto-align, CSV export, and comment sync run on QThread workers to avoid UI freezes. See `ui/workers.py` for `_CallableWorker` and `AutoAlignWorker`.
- **SQLite optimization** — composite index on `(run_datetime, imported_at)` and single-column indexes on `driver` / `vehicle` for filtered queries. Paginated API available via `list_records_paginated()`.

### Module Dependency Chain

```
models.py          (pure data classes — no internal deps)
settings.py        (config parsing — no internal deps)
parser.py          → models.py
xrk_dll.py         → models.py, parser.py (infer_channel_dtype)
processor.py       → models.py
analyzer.py        → models.py, processor.py
comments.py        (stdlib only — comment thread parse/add/update/delete)
library.py         → parser.py, settings.py
ui/theme.py           → settings.py
ui/formatting.py      → models.py (pure functions, no Qt)
ui/workers.py         → analyzer.py, library.py
ui/comments_panel.py  → comments.py
ui/dialogs.py         → library.py, settings.py
ui/channel_list.py    → models.py
ui/plot_stack.py      → models.py, processor.py, formatting.py
ui/timeline.py        → models.py, formatting.py
ui/track_panel.py     → analyzer.py, processor.py, formatting.py
ui/library_home.py    → comments.py, library.py, settings.py, comments_panel.py, workers.py
ui/main_window.py     → all child ui/* modules, models.py, parser.py, processor.py, settings.py, theme.py
app.py                → parser.py, ui/main_window.py
```

### Data Model

`TelemetryDataset` is the central data structure — a `@dataclass` holding:
- `meta: SessionMeta` (file path, type, driver, vehicle, laps, etc.)
- `channels: dict[str, ChannelMeta]` (key → name/unit/source/dtype)
- `frame: pd.DataFrame` (data matrix with "Time" as the index column)
- `header_order: list[str]` (column ordering)

### Analysis Flow

1. `parser.py:load_telemetry()` parses .xrk/.xrz (via DLL) or .csv → `TelemetryDataset`
2. `processor.py:visible_frame()` slices the dataset by time window + offset
3. `analyzer.py:summarize_channel()` computes min/max/avg/std per channel
4. `analyzer.py:compare_channel()` computes RMSE/MAE/corr between two datasets
5. `analyzer.py:estimate_offset()` uses cross-correlation to auto-align dual-file time axes

### Key Files

| File | Purpose |
|---|---|
| `scut_telemetry/xrk_dll.py` | ctypes bridge to AiM's C++ DLL for .xrk/.xrz parsing |
| `scut_telemetry/parser.py` | CSV parser + unified `load_telemetry()` entry point |
| `scut_telemetry/processor.py` | Time window slicing, cursor sampling, CSV export |
| `scut_telemetry/analyzer.py` | Channel statistics, dual-file comparison, auto offset estimation via cross-correlation |
| `scut_telemetry/library.py` | SQLite-backed local telemetry file management with paginated queries and indexes |
| `scut_telemetry/comments.py` | Structured comment thread parsing, serialization, add/update/delete |
| `scut_telemetry/models.py` | Core data classes (ChannelMeta, SessionMeta, TelemetryDataset, TimeWindow) |
| `scut_telemetry/settings.py` | Double-layer config (setting.md primary, settings.json fallback) |
| `scut_telemetry/ui/main_window.py` | MainWindow orchestration (~700 lines): signal wiring, file loading, export commands |
| `scut_telemetry/ui/theme.py` | Dark/light theme with QPalette + QSS + pyqtgraph config |
| `scut_telemetry/ui/formatting.py` | Pure formatting helpers (format_value, downsample, snap_to_sample) |
| `scut_telemetry/ui/workers.py` | QThread background workers (LibraryImportWorker, _CallableWorker, AutoAlignWorker) |
| `scut_telemetry/ui/comments_panel.py` | CommentsPanel: structured comment display, add, edit, delete |
| `scut_telemetry/ui/dialogs.py` | SettingsDialog, LibraryRunDialog |
| `scut_telemetry/ui/channel_list.py` | ChannelRow, ChannelList: channel selection, metadata panel |
| `scut_telemetry/ui/timeline.py` | TimelineWidget: overview timeline with region selection |
| `scut_telemetry/ui/plot_stack.py` | TelemetryPlotStack, YAxisZoomItem: main chart area with downsampling |
| `scut_telemetry/ui/track_panel.py` | TrackPanel: GPS track map + per-channel statistics |
| `scut_telemetry/ui/library_home.py` | LibraryHome: file import, categories, record table, comments |

### Testing

- `code/tests/test_comments.py` — 32 tests covering comment parsing, serialization, and CRUD
- `code/tests/test_library.py` — 38 tests covering note parsing, filename utils, datetime parsing, TelemetryLibrary integration, pagination
- `code/tests/test_parser.py` — 70 tests covering CSV parsing, channel inference, normalization, export round-trip
- Run all: `cd code && python -m pytest tests/ -v` (140 tests, ~2s)
- `code/check.ps1` — full quality gate: pytest → import check → compileall → build
- `code/scripts/compare_xrk_csv.py` — validates XRK DLL output against CSV export
- `code/scripts/xrk_to_csv.py` — batch converts .xrk to .csv

### Packaging

- PyInstaller one-directory mode (not one-file) for faster startup and easy config editing
- DLLs embedded via `--add-binary` into `_internal/TestMatLabXRK/`
- `build.ps1` preserves the `library/` database across rebuilds
