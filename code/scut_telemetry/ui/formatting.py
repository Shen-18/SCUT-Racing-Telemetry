from __future__ import annotations

import numpy as np

from ..models import TelemetryDataset, TimeWindow


def format_value(value: float) -> str:
    try:
        value = float(value)
    except Exception:
        return "--"
    if not np.isfinite(value):
        return "--"
    if abs(value) >= 1000:
        return f"{value:.1f}"
    if abs(value) >= 100:
        return f"{value:.2f}"
    if abs(value) >= 10:
        return f"{value:.3f}"
    return f"{value:.4f}"


def snap_to_sample_time(dataset: TelemetryDataset | None, t: float, offset: float = 0.0) -> float:
    if not dataset or dataset.frame.empty or "Time" not in dataset.frame:
        return max(0.0, float(t))
    time_arr = dataset.frame["Time"].to_numpy(dtype=float) + float(offset)
    mask = np.isfinite(time_arr) & (time_arr >= 0)
    if not np.any(mask):
        return max(0.0, float(t))
    valid = time_arr[mask]
    idx = int(np.searchsorted(valid, t))
    if idx <= 0:
        return float(valid[0])
    if idx >= len(valid):
        return float(valid[-1])
    before = valid[idx - 1]
    after = valid[idx]
    return float(before if abs(t - before) <= abs(after - t) else after)


def bounded_time_window(start: float, end: float, max_time: float) -> TimeWindow:
    max_time = max(0.05, float(max_time))
    start = float(start)
    end = float(end)
    span = max(0.05, min(end - start, max_time))
    if start < 0:
        start = 0.0
        end = span
    if end > max_time:
        end = max_time
        start = max(0.0, end - span)
    return TimeWindow(start, end)


def finite_sorted_xy(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = np.isfinite(x) & (x >= 0)
    x = x[mask]
    y = y[mask]
    y = np.where(np.isfinite(y), y, np.nan)
    if len(x) > 1 and np.any(np.diff(x) < 0):
        sort_idx = np.argsort(x, kind="mergesort")
        x = x[sort_idx]
        y = y[sort_idx]
    return x, y


def downsample_true_xy(x: np.ndarray, y: np.ndarray, max_points: int) -> tuple[np.ndarray, np.ndarray]:
    """Reduce dense lines while preserving per-bucket min/max so brief extrema remain visible."""
    n = len(x)
    if n <= max_points or max_points < 8:
        return x, y
    n_buckets = max(4, max_points // 2)
    if n_buckets >= n:
        return x, y
    edges = np.linspace(0, n, n_buckets + 1, dtype=np.int64)
    starts = edges[:-1]
    keep = edges[1:] > starts
    starts = starts[keep]
    if len(starts) == 0:
        return x, y

    finite = np.isfinite(y)
    y_for_min = np.where(finite, y, np.inf)
    y_for_max = np.where(finite, y, -np.inf)

    seg_min = np.minimum.reduceat(y_for_min, starts)
    seg_max = np.maximum.reduceat(y_for_max, starts)
    nan_bucket = ~np.isfinite(seg_min) | ~np.isfinite(seg_max)

    ends = np.empty_like(starts)
    ends[:-1] = starts[1:]
    ends[-1] = n
    x_start = x[starts]
    x_end = x[ends - 1]

    out_x = np.empty(len(starts) * 2, dtype=x.dtype)
    out_y = np.empty(len(starts) * 2, dtype=np.float64)
    out_x[0::2] = x_start
    out_x[1::2] = x_end
    out_y[0::2] = np.where(nan_bucket, np.nan, seg_min)
    out_y[1::2] = np.where(nan_bucket, np.nan, seg_max)
    return out_x, out_y


def visible_downsampled_xy(
    x: np.ndarray,
    y: np.ndarray,
    window: TimeWindow,
    max_points: int,
) -> tuple[np.ndarray, np.ndarray]:
    if len(x) <= max_points:
        return x, y
    span = max(0.0, float(window.end) - float(window.start))
    margin = max(0.05, span * 0.03)
    start = max(0.0, float(window.start) - margin)
    end = float(window.end) + margin
    left = max(0, int(np.searchsorted(x, start, side="left")) - 1)
    right = min(len(x), int(np.searchsorted(x, end, side="right")) + 1)
    if right <= left:
        return x[:0], y[:0]
    return downsample_true_xy(x[left:right], y[left:right], max_points)
