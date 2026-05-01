# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
# Run the app (development)
cd code && python -m scut_telemetry

# Quick smoke test for XRK DLL parsing
cd code && python -m scut_telemetry --smoke-xrk <path_to_xrk_file>

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
- **Single-file UI** — `ui/main_window.py` (~5800 lines) contains the entire GUI (LibraryPage, AnalysisPage, SettingsPage as a QStackedWidget). This is intentional for now.
- **Dual-file comparison** — overlay and split modes, with cross-correlation-based auto offset estimation in `analyzer.py:estimate_offset()`.

### Module Dependency Chain

```
models.py          (pure data classes — no internal deps)
settings.py        (config parsing — no internal deps)
parser.py          → models.py
xrk_dll.py         → models.py, parser.py (infer_channel_dtype)
processor.py       → models.py
analyzer.py        → models.py, processor.py
library.py         → parser.py, settings.py
ui/theme.py        → settings.py
ui/main_window.py  → analyzer.py, library.py, models.py, parser.py, processor.py, settings.py, theme.py
app.py             → parser.py, ui/main_window.py
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
| `scut_telemetry/analyzer.py` | Channel statistics, dual-file comparison, auto offset |
| `scut_telemetry/library.py` | SQLite-backed local telemetry file management |
| `scut_telemetry/models.py` | Core data classes (ChannelMeta, SessionMeta, TelemetryDataset, TimeWindow) |
| `scut_telemetry/settings.py` | Double-layer config (setting.md primary, settings.json fallback) |
| `scut_telemetry/ui/main_window.py` | Full PySide6 GUI (LibraryPage, AnalysisPage, SettingsPage in QStackedWidget) |
| `scut_telemetry/ui/theme.py` | Dark/light theme with QPalette + QSS + pyqtgraph config |

### Testing / Utilities

- `code/scripts/compare_xrk_csv.py` — validates XRK DLL output against CSV export
- `code/scripts/xrk_to_csv.py` — batch converts .xrk to .csv
- `code/test_headless.py`, `test_perf.py`, `test_plot.py` — ad-hoc tests (no test framework)

### Packaging

- PyInstaller one-directory mode (not one-file) for faster startup and easy config editing
- DLLs embedded via `--add-binary` into `_internal/TestMatLabXRK/`
- `build.ps1` preserves the `library/` database across rebuilds
