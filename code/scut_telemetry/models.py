from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import pandas as pd


ChannelDType = Literal["time", "numeric", "flag", "text"]
FileType = Literal["csv", "xrk"]


@dataclass(frozen=True)
class ChannelMeta:
    key: str
    name: str
    unit: str
    source: str = "csv"
    dtype: ChannelDType = "numeric"
    original_index: int | None = None

    @property
    def label(self) -> str:
        return f"{self.name} [{self.unit}]" if self.unit else self.name


@dataclass
class LapInfo:
    index: int
    start: float
    duration: float


@dataclass
class SessionMeta:
    file_path: Path
    file_type: FileType
    session: str = ""
    vehicle: str = ""
    racer: str = ""
    championship: str = ""
    comment: str = ""
    date: str = ""
    start_time: str = ""
    sample_rate_hz: float = 20.0
    duration: float = 0.0
    laps: list[LapInfo] = field(default_factory=list)


@dataclass
class TelemetryDataset:
    id: str
    meta: SessionMeta
    channels: dict[str, ChannelMeta]
    frame: pd.DataFrame
    header_order: list[str] = field(default_factory=list)
    raw_metadata: list[tuple[str, str]] = field(default_factory=list)

    @property
    def name(self) -> str:
        stem = self.meta.file_path.stem
        racer = self.meta.racer.strip()
        return f"{stem} - {racer}" if racer else stem

    @property
    def time(self):
        return self.frame["Time"].to_numpy(dtype=float)

    @property
    def max_time(self) -> float:
        if self.frame.empty:
            return 0.0
        return float(self.frame["Time"].max())

    def numeric_channels(self, include_flags: bool = True) -> list[ChannelMeta]:
        result: list[ChannelMeta] = []
        for key in self.header_order:
            meta = self.channels.get(key)
            if not meta or meta.dtype == "time":
                continue
            if meta.dtype == "numeric" or (include_flags and meta.dtype == "flag"):
                result.append(meta)
        return result


@dataclass(frozen=True)
class TimeWindow:
    start: float
    end: float

    def clamped(self, max_time: float) -> "TimeWindow":
        start = max(0.0, min(float(self.start), max_time))
        end = max(start, min(float(self.end), max_time))
        return TimeWindow(start, end)
