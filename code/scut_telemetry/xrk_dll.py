from __future__ import annotations

import ctypes
import math
import os
import sys
from ctypes import POINTER, c_char_p, c_double, c_int
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd

from .models import ChannelMeta, LapInfo, SessionMeta, TelemetryDataset
from .parser import infer_channel_dtype


FREQ_HZ = 20.0
GPS_CHANNELS = [
    "GPS Speed",
    "GPS Nsat",
    "GPS LatAcc",
    "GPS LonAcc",
    "GPS Slope",
    "GPS Heading",
    "GPS Gyro",
    "GPS Altitude",
    "GPS PosAccuracy",
    "GPS SpdAccuracy",
    "GPS Radius",
    "GPS Latitude",
    "GPS Longitude",
]


@dataclass
class RawChannel:
    name: str
    unit: str
    times: np.ndarray
    values: np.ndarray
    source: str


class Tm(ctypes.Structure):
    _fields_ = [
        ("tm_sec", c_int),
        ("tm_min", c_int),
        ("tm_hour", c_int),
        ("tm_mday", c_int),
        ("tm_mon", c_int),
        ("tm_year", c_int),
        ("tm_wday", c_int),
        ("tm_yday", c_int),
        ("tm_isdst", c_int),
    ]


class XrkDll:
    def __init__(self, dll_path: Path | None = None):
        self.dll_path = dll_path or find_default_dll()
        if not self.dll_path.exists():
            raise FileNotFoundError(f"MatLabXRK DLL not found: {self.dll_path}")

        dll_dir = self.dll_path.parent
        dep_dir = dll_dir.parent / "64"
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(dll_dir))
            if dep_dir.exists():
                os.add_dll_directory(str(dep_dir))

        self.lib = ctypes.CDLL(str(self.dll_path))
        self._bind()
        try:
            self.lib.set_GPS_sample_freq(c_double(FREQ_HZ))
        except Exception:
            pass

    def _bind(self) -> None:
        lib = self.lib
        lib.open_file.argtypes = [c_char_p]
        lib.open_file.restype = c_int
        lib.close_file_i.argtypes = [c_int]
        lib.close_file_i.restype = c_int
        if hasattr(lib, "get_last_open_error"):
            lib.get_last_open_error.restype = c_char_p
        if hasattr(lib, "set_GPS_sample_freq"):
            lib.set_GPS_sample_freq.argtypes = [c_double]
            lib.set_GPS_sample_freq.restype = c_int

        for name in (
            "get_vehicle_name",
            "get_track_name",
            "get_racer_name",
            "get_championship_name",
            "get_session_type_name",
        ):
            func = getattr(lib, name)
            func.argtypes = [c_int]
            func.restype = c_char_p

        lib.get_date_and_time.argtypes = [c_int]
        lib.get_date_and_time.restype = POINTER(Tm)
        lib.get_laps_count.argtypes = [c_int]
        lib.get_laps_count.restype = c_int
        lib.get_lap_info.argtypes = [c_int, c_int, POINTER(c_double), POINTER(c_double)]
        lib.get_lap_info.restype = c_int
        lib.get_session_duration.argtypes = [c_int, POINTER(c_double)]
        lib.get_session_duration.restype = c_int

        self._bind_channel_family(
            "get_channels_count",
            "get_channel_name",
            "get_channel_units",
            "get_channel_samples_count",
            "get_channel_samples",
        )
        self._bind_channel_family(
            "get_GPS_channels_count",
            "get_GPS_channel_name",
            "get_GPS_channel_units",
            "get_GPS_channel_samples_count",
            "get_GPS_channel_samples",
        )

    def _bind_channel_family(self, count_name: str, name_name: str, units_name: str, sample_count_name: str, samples_name: str) -> None:
        getattr(self.lib, count_name).argtypes = [c_int]
        getattr(self.lib, count_name).restype = c_int
        getattr(self.lib, name_name).argtypes = [c_int, c_int]
        getattr(self.lib, name_name).restype = c_char_p
        getattr(self.lib, units_name).argtypes = [c_int, c_int]
        getattr(self.lib, units_name).restype = c_char_p
        getattr(self.lib, sample_count_name).argtypes = [c_int, c_int]
        getattr(self.lib, sample_count_name).restype = c_int
        getattr(self.lib, samples_name).argtypes = [c_int, c_int, POINTER(c_double), POINTER(c_double), c_int]
        getattr(self.lib, samples_name).restype = c_int

    def open(self, path: Path) -> int:
        idx = self.lib.open_file(str(path.resolve()).encode("mbcs"))
        if idx <= 0:
            detail = ""
            if hasattr(self.lib, "get_last_open_error"):
                detail = decode_bytes(self.lib.get_last_open_error() or b"")
            raise RuntimeError(f"Could not open XRK file: {path}. {detail}".strip())
        return idx

    def close(self, idx: int) -> None:
        if idx > 0:
            self.lib.close_file_i(idx)

    def text(self, func_name: str, idx: int) -> str:
        return decode_bytes(getattr(self.lib, func_name)(idx))

    def duration(self, idx: int) -> float:
        value = c_double(0.0)
        if self.lib.get_session_duration(idx, ctypes.byref(value)) == 1 and value.value > 0:
            return float(value.value)
        laps = self.laps(idx)
        if laps:
            return max(lap.start + lap.duration for lap in laps)
        return 0.0

    def laps(self, idx: int) -> list[LapInfo]:
        count = self.lib.get_laps_count(idx)
        result: list[LapInfo] = []
        for lap_idx in range(max(0, count)):
            start = c_double(0.0)
            duration = c_double(0.0)
            if self.lib.get_lap_info(idx, lap_idx, ctypes.byref(start), ctypes.byref(duration)) == 1:
                result.append(LapInfo(lap_idx, float(start.value), float(duration.value)))
        return result

    def channel_family(self, idx: int, source: str) -> list[RawChannel]:
        if source == "gps":
            names = (
                self.lib.get_GPS_channels_count,
                self.lib.get_GPS_channel_name,
                self.lib.get_GPS_channel_units,
                self.lib.get_GPS_channel_samples_count,
                self.lib.get_GPS_channel_samples,
            )
        else:
            names = (
                self.lib.get_channels_count,
                self.lib.get_channel_name,
                self.lib.get_channel_units,
                self.lib.get_channel_samples_count,
                self.lib.get_channel_samples,
            )
        count_func, name_func, unit_func, sample_count_func, sample_func = names
        result: list[RawChannel] = []
        for channel_idx in range(max(0, count_func(idx))):
            name = decode_bytes(name_func(idx, channel_idx))
            unit = decode_bytes(unit_func(idx, channel_idx))
            count = sample_count_func(idx, channel_idx)
            if count <= 0:
                continue
            times = (c_double * count)()
            values = (c_double * count)()
            recovered = sample_func(idx, channel_idx, times, values, count)
            if recovered <= 0:
                continue
            time_arr = np.ctypeslib.as_array(times).astype(float).copy()
            value_arr = np.ctypeslib.as_array(values).astype(float).copy()
            if source == "gps" and len(time_arr) and np.nanmax(time_arr) > 1000.0:
                time_arr = time_arr / 1000.0
            result.append(RawChannel(name=name, unit=unit, times=time_arr, values=value_arr, source=source))
        return result


def parse_xrk(path: str | Path, dll_path: str | Path | None = None) -> TelemetryDataset:
    path = Path(path).resolve()
    dll = XrkDll(Path(dll_path).resolve() if dll_path else None)
    idx = dll.open(path)
    try:
        duration = dll.duration(idx)
        if duration <= 0:
            raise RuntimeError("XRK reported zero duration")
        sample_count = int(round(duration * FREQ_HZ))
        timeline = np.arange(sample_count, dtype=float) / FREQ_HZ
        gps_channels = dll.channel_family(idx, "gps")
        standard_channels = dll.channel_family(idx, "standard")
        frame_data: dict[str, np.ndarray] = {"Time": timeline}
        units: dict[str, str] = {"Time": "s"}
        sources: dict[str, str] = {"Time": "xrk"}

        for channel in gps_channels:
            if channel.name not in GPS_CHANNELS:
                continue
            values, unit = convert_channel_units(channel.name, channel.unit, channel.values)
            frame_data[channel.name] = resample_values(channel.times, values, timeline)
            units[channel.name] = unit
            sources[channel.name] = "xrk:gps"

        for channel in standard_channels:
            values, unit = convert_channel_units(channel.name, channel.unit, channel.values)
            frame_data[channel.name] = resample_values(channel.times, values, timeline)
            units[channel.name] = unit
            sources[channel.name] = "xrk"

        if "GPS Speed" in frame_data:
            speed_mps = frame_data["GPS Speed"] / 3.6
            distance = np.zeros_like(speed_mps)
            if len(speed_mps) > 1:
                distance[1:] = np.cumsum(speed_mps[:-1] / FREQ_HZ)
            frame_data["Distance on GPS Speed"] = distance
            units["Distance on GPS Speed"] = "m"
            sources["Distance on GPS Speed"] = "derived"

        order = ["Time"] + [name for name in GPS_CHANNELS if name in frame_data]
        order += [channel.name for channel in standard_channels if channel.name in frame_data and channel.name not in order]
        if "Distance on GPS Speed" in frame_data:
            order.append("Distance on GPS Speed")

        frame = pd.DataFrame({key: frame_data[key] for key in order})
        channels: dict[str, ChannelMeta] = {}
        for idx_col, key in enumerate(order):
            unit = units.get(key, "")
            channels[key] = ChannelMeta(
                key=key,
                name=key,
                unit=unit,
                source=sources.get(key, "xrk"),
                dtype=infer_channel_dtype(frame[key], key, unit),
                original_index=idx_col,
            )

        date_text, time_text = format_tm(dll.lib.get_date_and_time(idx))
        session_name = dll.text("get_track_name", idx) or session_from_gps(frame)
        meta = SessionMeta(
            file_path=path,
            file_type="xrk",
            session=session_name,
            vehicle=dll.text("get_vehicle_name", idx),
            racer=dll.text("get_racer_name", idx),
            championship=dll.text("get_championship_name", idx),
            date=date_text,
            start_time=time_text,
            sample_rate_hz=FREQ_HZ,
            duration=duration,
            laps=dll.laps(idx),
        )
        return TelemetryDataset(
            id=uuid4().hex,
            meta=meta,
            channels=channels,
            frame=frame,
            header_order=order,
            raw_metadata=[],
        )
    finally:
        dll.close(idx)


def find_default_dll() -> Path:
    candidates: list[Path] = []
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates.extend(
            [
                base / "TestMatLabXRK" / "DLL-2022" / "MatLabXRK-2022-64-ReleaseU.dll",
                Path(sys.executable).parent / "TestMatLabXRK" / "DLL-2022" / "MatLabXRK-2022-64-ReleaseU.dll",
            ]
        )
    here = Path(__file__).resolve()
    candidates.extend(
        [
            here.parents[2] / "TestMatLabXRK" / "DLL-2022" / "MatLabXRK-2022-64-ReleaseU.dll",
            here.parents[3] / "TestMatLabXRK" / "DLL-2022" / "MatLabXRK-2022-64-ReleaseU.dll",
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def resample_values(times: np.ndarray, values: np.ndarray, timeline: np.ndarray) -> np.ndarray:
    if len(times) == 0:
        return np.full_like(timeline, np.nan, dtype=float)
    order = np.argsort(times)
    x = times[order]
    y = values[order]
    unique_x, unique_idx = np.unique(x, return_index=True)
    unique_y = y[unique_idx]
    if len(unique_x) == 1:
        return np.full_like(timeline, unique_y[0], dtype=float)
    return np.interp(timeline, unique_x, unique_y, left=unique_y[0], right=unique_y[-1])


def convert_channel_units(name: str, unit: str, values: np.ndarray) -> tuple[np.ndarray, str]:
    unit = unit.strip()
    out = values.astype(float, copy=True)
    if name == "GPS Speed" and unit == "m/s":
        return out * 3.6, "km/h"
    if name == "GPS PosAccuracy" and unit.lower() == "cm":
        return out * 10.0, "mm"
    if name == "GPS SpdAccuracy":
        return out, "km/h"
    if name == "GPS Nsat":
        return out, " "
    if name == "LoggerTemp" and unit == "C":
        return out, "°C"
    return out, unit


def decode_bytes(value: bytes | None) -> str:
    if not value:
        return ""
    for encoding in ("utf-8", "mbcs", "latin1"):
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")


def format_tm(tm_ptr) -> tuple[str, str]:
    if not tm_ptr:
        return "", ""
    tm = tm_ptr.contents
    year = tm.tm_year + 1900
    month = tm.tm_mon + 1
    day = tm.tm_mday
    weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    weekday = weekdays[tm.tm_wday % 7] if 0 <= tm.tm_wday <= 6 else ""
    date_text = f"{weekday}, {months[month - 1]} {day}, {year}" if 1 <= month <= 12 else ""
    hour = tm.tm_hour
    suffix = "AM" if hour < 12 else "PM"
    hour12 = hour % 12 or 12
    time_text = f"{hour12}:{tm.tm_min:02d} {suffix}"
    return date_text, time_text


def session_from_gps(frame: pd.DataFrame) -> str:
    if "GPS Latitude" not in frame or "GPS Longitude" not in frame or frame.empty:
        return ""
    lat = float(frame["GPS Latitude"].iloc[0])
    lon = float(frame["GPS Longitude"].iloc[0])
    if not math.isfinite(lat) or not math.isfinite(lon):
        return ""
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{abs(lat):.3f}°{ns}, {abs(lon):.3f}°{ew}"
