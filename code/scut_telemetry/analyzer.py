from __future__ import annotations

import numpy as np
import pandas as pd

from .models import TelemetryDataset, TimeWindow
from .processor import visible_frame


def summarize_channel(dataset: TelemetryDataset, channel: str, window: TimeWindow | None = None) -> dict[str, float]:
    if channel not in dataset.frame:
        return {"min": np.nan, "max": np.nan, "avg": np.nan, "std": np.nan, "count": 0}
    if window is None:
        values = dataset.frame[channel].to_numpy(dtype=float, copy=False)
    else:
        time = dataset.frame["Time"].to_numpy(dtype=float, copy=False)
        win = window.clamped(dataset.max_time)
        left = int(np.searchsorted(time, win.start, side="left"))
        right = int(np.searchsorted(time, win.end, side="right"))
        values = dataset.frame[channel].to_numpy(dtype=float, copy=False)[left:right]
    values = values[np.isfinite(values)]
    if len(values) == 0:
        return {"min": np.nan, "max": np.nan, "avg": np.nan, "std": np.nan, "count": 0}
    return {
        "min": float(np.min(values)),
        "max": float(np.max(values)),
        "avg": float(np.mean(values)),
        "std": float(np.std(values)),
        "count": int(len(values)),
    }


def compare_channel(
    reference: TelemetryDataset,
    target: TelemetryDataset,
    channel: str,
    window: TimeWindow | None = None,
    offset_target: float = 0.0,
) -> dict[str, float]:
    if channel not in reference.frame or channel not in target.frame:
        return {"rmse": np.nan, "mae": np.nan, "corr": np.nan, "max_abs_error": np.nan}
    a = visible_frame(reference, window)
    b = visible_frame(target, window, offset_target)
    if a.empty or b.empty:
        return {"rmse": np.nan, "mae": np.nan, "corr": np.nan, "max_abs_error": np.nan}
    x = a["AlignedTime"].to_numpy(dtype=float)
    av = a[channel].to_numpy(dtype=float)
    bv = np.interp(x, b["AlignedTime"].to_numpy(dtype=float), b[channel].to_numpy(dtype=float), left=np.nan, right=np.nan)
    mask = np.isfinite(av) & np.isfinite(bv)
    if not np.any(mask):
        return {"rmse": np.nan, "mae": np.nan, "corr": np.nan, "max_abs_error": np.nan}
    diff = av[mask] - bv[mask]
    if mask.sum() > 2 and np.nanstd(av[mask]) > 1e-12 and np.nanstd(bv[mask]) > 1e-12:
        corr = np.corrcoef(av[mask], bv[mask])[0, 1]
    else:
        corr = np.nan
    return {
        "rmse": float(np.sqrt(np.mean(diff * diff))),
        "mae": float(np.mean(np.abs(diff))),
        "corr": float(corr),
        "max_abs_error": float(np.max(np.abs(diff))),
    }


def estimate_offset(
    reference: TelemetryDataset,
    target: TelemetryDataset,
    channel: str,
    window: TimeWindow | None = None,
    max_shift_seconds: float = 10.0,
) -> float:
    if channel not in reference.frame or channel not in target.frame:
        return 0.0
    a = visible_frame(reference, window)
    b = visible_frame(target, window)
    if a.empty or b.empty:
        return 0.0
    start = max(float(a["AlignedTime"].min()), float(b["AlignedTime"].min()))
    end = min(float(a["AlignedTime"].max()), float(b["AlignedTime"].max()))
    if end <= start + 1.0:
        return 0.0
    step = 0.05
    x = np.arange(start, end, step)
    av = np.interp(x, a["AlignedTime"].to_numpy(dtype=float), a[channel].to_numpy(dtype=float))
    bv = np.interp(x, b["AlignedTime"].to_numpy(dtype=float), b[channel].to_numpy(dtype=float))
    av = np.nan_to_num(av - np.nanmean(av))
    bv = np.nan_to_num(bv - np.nanmean(bv))
    max_lag = int(max_shift_seconds / step)
    corr = np.correlate(av, bv, mode="full")
    lags = np.arange(-len(bv) + 1, len(av))
    mask = (lags >= -max_lag) & (lags <= max_lag)
    if not np.any(mask):
        return 0.0
    best_lag = lags[mask][int(np.argmax(corr[mask]))]
    return float(best_lag * step)
