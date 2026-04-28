from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .models import TelemetryDataset, TimeWindow


def visible_frame(dataset: TelemetryDataset, window: TimeWindow | None = None, offset: float = 0.0) -> pd.DataFrame:
    frame = dataset.frame.copy()
    frame["AlignedTime"] = frame["Time"] + float(offset)
    frame = frame[frame["AlignedTime"] >= 0]
    if window is not None:
        win = window.clamped(max(float(frame["AlignedTime"].max()) if not frame.empty else 0.0, 0.0))
        frame = frame[(frame["AlignedTime"] >= win.start) & (frame["AlignedTime"] <= win.end)]
    return frame.reset_index(drop=True)


def clamp_window(start: float, end: float, max_time: float) -> TimeWindow:
    start = max(0.0, min(float(start), max_time))
    end = max(start, min(float(end), max_time))
    return TimeWindow(start, end)


def sample_at(dataset: TelemetryDataset, channel: str, t: float, offset: float = 0.0) -> float:
    if channel not in dataset.frame:
        return float("nan")
    time = dataset.frame["Time"].to_numpy(dtype=float) + float(offset)
    values = dataset.frame[channel].to_numpy(dtype=float)
    mask = np.isfinite(time) & np.isfinite(values) & (time >= 0)
    if not np.any(mask):
        return float("nan")
    x = time[mask]
    y = values[mask]
    idx = int(np.searchsorted(x, t))
    if idx <= 0:
        return float(y[0])
    if idx >= len(x):
        return float(y[-1])
    return float(y[idx - 1] if abs(t - x[idx - 1]) <= abs(x[idx] - t) else y[idx])


def export_selected_csv(
    dataset_a: TelemetryDataset,
    path: str | Path,
    channels: list[str],
    window: TimeWindow | None = None,
    dataset_b: TelemetryDataset | None = None,
    offset_b: float = 0.0,
) -> None:
    path = Path(path)
    frame_a = visible_frame(dataset_a, window)
    selected_a = ["AlignedTime"] + [ch for ch in channels if ch in frame_a]
    out = frame_a[selected_a].rename(columns={"AlignedTime": "Time"}).copy()
    out.columns = ["Time"] + [f"A:{dataset_a.channels[ch].label}" for ch in selected_a[1:]]
    if dataset_b is not None:
        frame_b = visible_frame(dataset_b, window, offset_b)
        for ch in channels:
            if ch not in frame_b:
                continue
            values = np.interp(
                out["Time"].to_numpy(dtype=float),
                frame_b["AlignedTime"].to_numpy(dtype=float),
                frame_b[ch].to_numpy(dtype=float),
                left=np.nan,
                right=np.nan,
            )
            label = dataset_b.channels[ch].label if ch in dataset_b.channels else ch
            out[f"B:{label}"] = values
    out.to_csv(path, index=False, encoding="utf-8-sig")
