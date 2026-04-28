from __future__ import annotations

import csv
import math
import re
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd

from .models import ChannelMeta, LapInfo, SessionMeta, TelemetryDataset


def load_telemetry(path: str | Path, *, fallback_csv: bool = True) -> TelemetryDataset:
    path = Path(path).resolve()
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return parse_csv(path)
    if suffix in {".xrk", ".xrz"}:
        try:
            from .xrk_dll import parse_xrk

            return parse_xrk(path)
        except Exception:
            if fallback_csv:
                fallback = path.with_suffix(".csv")
                if fallback.exists():
                    return parse_csv(fallback)
            raise
    raise ValueError(f"Unsupported telemetry file: {path}")


def parse_csv(path: str | Path) -> TelemetryDataset:
    path = Path(path).resolve()
    text = _read_text(path)
    rows = _read_csv_rows(text)
    header_idx = _find_header_row(rows)
    if header_idx < 0:
        raise ValueError(f"Could not find RaceStudio header row in {path}")

    names = [cell.strip() for cell in rows[header_idx]]
    units = [cell.strip() for cell in rows[header_idx + 1]]
    data_rows = [row for row in rows[header_idx + 2 :] if row and any(cell.strip() for cell in row)]
    if not names or names[0] != "Time":
        raise ValueError(f"CSV must contain Time as first column: {path}")

    keys = _make_unique_keys(names)
    table: dict[str, list[float]] = {key: [] for key in keys}
    for row in data_rows:
        padded = row + [""] * (len(keys) - len(row))
        for key, cell in zip(keys, padded):
            table[key].append(_to_float(cell))

    frame = pd.DataFrame(table)
    if "Time" not in frame:
        raise ValueError(f"CSV did not produce a Time column: {path}")
    frame = frame.dropna(subset=["Time"]).reset_index(drop=True)
    frame = normalize_frame_time(frame)

    metadata_pairs = _metadata_pairs(rows[:header_idx])
    metadata = dict(metadata_pairs)
    duration = _float_or_default(metadata.get("Duration"), float(frame["Time"].max()) if not frame.empty else 0.0)
    sample_rate = _float_or_default(metadata.get("Sample Rate"), infer_sample_rate(frame["Time"]))
    laps = _laps_from_metadata(metadata)

    channels: dict[str, ChannelMeta] = {}
    for idx, (key, name) in enumerate(zip(keys, names)):
        unit = units[idx] if idx < len(units) else ""
        dtype = infer_channel_dtype(frame[key], name, unit)
        channels[key] = ChannelMeta(
            key=key,
            name=name,
            unit=unit,
            source="csv",
            dtype=dtype,
            original_index=idx,
        )

    meta = SessionMeta(
        file_path=path,
        file_type="csv",
        session=metadata.get("Session", ""),
        vehicle=metadata.get("Vehicle", ""),
        racer=metadata.get("Racer", ""),
        championship=metadata.get("Championship", ""),
        comment=metadata.get("Comment", ""),
        date=metadata.get("Date", ""),
        start_time=metadata.get("Time", ""),
        sample_rate_hz=sample_rate,
        duration=duration,
        laps=laps,
    )
    return TelemetryDataset(
        id=uuid4().hex,
        meta=meta,
        channels=channels,
        frame=frame,
        header_order=keys,
        raw_metadata=metadata_pairs,
    )


def normalize_frame_time(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or "Time" not in frame:
        return frame
    frame = frame.copy()
    min_time = frame["Time"].dropna().min()
    if math.isfinite(float(min_time)):
        frame["Time"] = frame["Time"] - float(min_time)
    frame = frame[frame["Time"] >= 0].reset_index(drop=True)
    return frame


def infer_sample_rate(time_series: pd.Series) -> float:
    values = time_series.dropna().to_numpy(dtype=float)
    if len(values) < 2:
        return 20.0
    diffs = np.diff(values)
    diffs = diffs[diffs > 0]
    if len(diffs) == 0:
        return 20.0
    return float(round(1.0 / np.median(diffs), 3))


def infer_channel_dtype(series: pd.Series, name: str, unit: str) -> str:
    if name == "Time":
        return "time"
    non_empty = series.dropna()
    if len(non_empty) == 0:
        return "numeric"
    numeric_ratio = pd.to_numeric(non_empty, errors="coerce").notna().sum() / len(non_empty)
    if numeric_ratio < 0.95:
        return "text"
    lower = name.lower()
    if unit == "#" or any(token in lower for token in ("flag", "state", "error", "latch", "type")):
        return "flag"
    return "numeric"


def export_racestudio_like_csv(dataset: TelemetryDataset, path: str | Path, comment_override: str | None = None) -> None:
    path = Path(path)
    ordered = dataset.header_order or list(dataset.frame.columns)
    metadata = _export_metadata(dataset, comment_override=comment_override)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_ALL, lineterminator="\n")
        for key, value in metadata:
            writer.writerow([key, value])
        writer.writerow([])
        writer.writerow([dataset.channels[col].name if col in dataset.channels else col for col in ordered])
        writer.writerow([dataset.channels[col].unit if col in dataset.channels else "" for col in ordered])
        writer.writerow([])
        for _, row in dataset.frame[ordered].iterrows():
            writer.writerow([_format_value(col, row[col]) for col in ordered])


def _read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "cp1252"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def _read_csv_rows(text: str) -> list[list[str]]:
    lines = text.splitlines()
    sample = "\n".join(lines[:50])
    candidates: list[csv.Dialect | str] = []
    try:
        candidates.append(csv.Sniffer().sniff(sample, delimiters=",;\t"))
    except csv.Error:
        pass
    candidates.extend([",", ";", "\t"])

    best_rows: list[list[str]] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate if isinstance(candidate, str) else getattr(candidate, "delimiter", ",")
        if key in seen:
            continue
        seen.add(key)
        rows = list(csv.reader(lines, dialect=candidate)) if not isinstance(candidate, str) else list(csv.reader(lines, delimiter=candidate))
        if _find_header_row(rows) >= 0:
            return rows
        if not best_rows:
            best_rows = rows
    return best_rows


def _find_header_row(rows: list[list[str]]) -> int:
    for idx, row in enumerate(rows):
        if row and row[0].strip() == "Time" and len(row) > 2:
            return idx
    return -1


def _metadata_pairs(rows: list[list[str]]) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    for row in rows:
        if not row:
            continue
        key = row[0].strip()
        if not key:
            continue
        value = row[1].strip() if len(row) > 1 else ""
        result.append((key, value))
    return result


def _make_unique_keys(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    keys: list[str] = []
    for name in names:
        base = name.strip() or "Column"
        if base not in seen:
            seen[base] = 1
            keys.append(base)
            continue
        seen[base] += 1
        keys.append(f"{base} ({seen[base]})")
    return keys


def _to_float(value: str) -> float:
    value = str(value).strip().strip('"')
    if value == "":
        return math.nan
    if "," in value and "." not in value and re.fullmatch(r"[+-]?\d+,\d+(?:[eE][+-]?\d+)?", value):
        value = value.replace(",", ".")
    try:
        return float(value)
    except ValueError:
        cleaned = re.sub(r"[^0-9eE+\-.]", "", value)
        try:
            return float(cleaned)
        except ValueError:
            return math.nan


def _float_or_default(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _laps_from_metadata(metadata: dict[str, str]) -> list[LapInfo]:
    segment = metadata.get("Segment Times", "")
    if not segment:
        return []
    durations: list[float] = []
    for piece in segment.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        durations.append(_parse_lap_duration(piece))
    laps: list[LapInfo] = []
    start = 0.0
    for idx, duration in enumerate(durations):
        laps.append(LapInfo(idx, start, duration))
        start += duration
    return laps


def _parse_lap_duration(value: str) -> float:
    if ":" not in value:
        return _float_or_default(value, 0.0)
    minutes, seconds = value.split(":", 1)
    return float(minutes) * 60.0 + float(seconds)


def _export_metadata(dataset: TelemetryDataset, comment_override: str | None = None) -> list[tuple[str, str]]:
    meta = dataset.meta
    duration = int(round(meta.duration if meta.duration else dataset.max_time))
    laps = meta.laps or [LapInfo(0, 0.0, float(duration))]
    if len(laps) == 1:
        segment_times = _format_lap_time(float(duration))
    else:
        segment_times = ";".join(_format_lap_time(lap.duration) for lap in laps)
    return [
        ("Format", "AiM CSV File"),
        ("Session", meta.session),
        ("Vehicle", meta.vehicle),
        ("Racer", meta.racer),
        ("Championship", meta.championship),
        ("Comment", meta.comment if comment_override is None else comment_override),
        ("Date", meta.date),
        ("Time", meta.start_time),
        ("Sample Rate", f"{meta.sample_rate_hz:g}"),
        ("Duration", f"{duration:g}"),
        ("Segment", "Session"),
        ("Beacon Markers", f"{duration:g}"),
        ("Segment Times", segment_times),
    ]


def _format_lap_time(seconds: float) -> str:
    minutes = int(seconds // 60)
    rest = seconds - minutes * 60
    return f"{minutes}:{rest:06.3f}"


def _format_value(column: str, value: float) -> str:
    if pd.isna(value):
        return ""
    if column == "Time":
        return f"{float(value):.3f}"
    if abs(float(value) - round(float(value))) < 1e-9 and column not in {"GPS Latitude", "GPS Longitude"}:
        return f"{float(value):.0f}" if column in {"GPS Nsat"} else f"{float(value):.4f}"
    if column in {"GPS Latitude", "GPS Longitude"}:
        return f"{float(value):.8f}"
    return f"{float(value):.4f}"
