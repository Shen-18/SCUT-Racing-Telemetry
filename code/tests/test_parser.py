"""Tests for scut_telemetry.parser — telemetry file parsing and CSV export."""

from __future__ import annotations

import csv
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from scut_telemetry.parser import (
    infer_channel_dtype,
    infer_sample_rate,
    normalize_frame_time,
    _to_float,
    _make_unique_keys,
    _find_header_row,
    _read_csv_rows,
    _read_text,
    _float_or_default,
    _laps_from_metadata,
    _parse_lap_duration,
    _format_lap_time,
    _format_value,
    parse_csv,
    export_racestudio_like_csv,
)
from scut_telemetry.models import ChannelMeta, LapInfo, SessionMeta, TelemetryDataset


# ── _to_float ────────────────────────────────────────────────────

def test_to_float_normal():
    assert _to_float("3.14") == pytest.approx(3.14)
    assert _to_float("0") == 0.0
    assert _to_float("-1.5") == pytest.approx(-1.5)


def test_to_float_empty():
    assert np.isnan(_to_float(""))
    assert np.isnan(_to_float('""'))


def test_to_float_european_comma():
    assert _to_float("123,45") == pytest.approx(123.45)


def test_to_float_scientific():
    assert _to_float("1.5e-3") == pytest.approx(0.0015)


def test_to_float_invalid():
    assert np.isnan(_to_float("not a number"))


def test_to_float_aggressive_clean():
    # Characters are stripped and the remaining digits parsed
    val = _to_float("  12.34  ")
    assert val == pytest.approx(12.34)


# ── _make_unique_keys ────────────────────────────────────────────

def test_make_unique_keys_simple():
    assert _make_unique_keys(["Time", "Speed", "RPM"]) == ["Time", "Speed", "RPM"]


def test_make_unique_keys_duplicates():
    keys = _make_unique_keys(["A", "A", "A"])
    assert keys == ["A", "A (2)", "A (3)"]


def test_make_unique_keys_empty_name():
    keys = _make_unique_keys(["", ""])
    assert keys == ["Column", "Column (2)"]


# ── _find_header_row ─────────────────────────────────────────────

def test_find_header_row():
    rows = [["Session", "Test"], [], ["Time", "Speed", "RPM"], ["s", "km/h", "rpm"]]
    assert _find_header_row(rows) == 2


def test_find_header_row_not_found():
    assert _find_header_row([["No", "Header"]]) == -1


def test_find_header_row_short():
    assert _find_header_row([["Time", "X"]]) == -1  # need > 2 cols


# ── normalize_frame_time ─────────────────────────────────────────

def test_normalize_positive():
    df = pd.DataFrame({"Time": [10.0, 20.0, 30.0], "A": [1, 2, 3]})
    result = normalize_frame_time(df)
    assert result["Time"].iloc[0] == 0.0
    assert result["Time"].iloc[2] == pytest.approx(20.0)


def test_normalize_already_zero():
    df = pd.DataFrame({"Time": [0.0, 1.0], "A": [1, 2]})
    result = normalize_frame_time(df)
    assert result["Time"].iloc[0] == 0.0


def test_normalize_empty():
    df = pd.DataFrame({"Time": pd.Series([], dtype=float)})
    result = normalize_frame_time(df)
    assert result.empty


def test_normalize_no_time_column():
    df = pd.DataFrame({"A": [1, 2]})
    result = normalize_frame_time(df)
    pd.testing.assert_frame_equal(result, df)


# ── infer_sample_rate ────────────────────────────────────────────

def test_infer_sample_rate_regular():
    ts = pd.Series([0.0, 0.05, 0.10, 0.15])
    assert infer_sample_rate(ts) == pytest.approx(20.0)


def test_infer_sample_rate_single():
    assert infer_sample_rate(pd.Series([1.0])) == 20.0


def test_infer_sample_rate_empty():
    assert infer_sample_rate(pd.Series([], dtype=float)) == 20.0


def test_infer_sample_rate_irregular():
    ts = pd.Series([0.0, 0.1, 0.3, 0.6])
    rate = infer_sample_rate(ts)
    assert rate > 0


# ── infer_channel_dtype ──────────────────────────────────────────

def test_infer_time():
    assert infer_channel_dtype(pd.Series([0, 1, 2]), "Time", "s") == "time"


def test_infer_numeric():
    assert infer_channel_dtype(pd.Series([1.0, 2.0, 3.0]), "Speed", "km/h") == "numeric"


def test_infer_flag():
    assert infer_channel_dtype(pd.Series([0, 1, 0, 1]), "Error Flag", "#") == "flag"


def test_infer_flag_by_name():
    assert infer_channel_dtype(pd.Series([0, 1, 0, 1]), "State", "") == "flag"


def test_infer_text():
    assert infer_channel_dtype(pd.Series(["on", "off", "on", "off"]), "Status", "") == "text"


def test_infer_empty_series():
    assert infer_channel_dtype(pd.Series([], dtype=float), "X", "") == "numeric"


# ── _float_or_default ────────────────────────────────────────────

def test_float_or_default_valid():
    assert _float_or_default("3.14", 0.0) == pytest.approx(3.14)


def test_float_or_default_none():
    assert _float_or_default(None, 42.0) == 42.0


def test_float_or_default_invalid():
    assert _float_or_default("??", 99.0) == 99.0


# ── _parse_lap_duration ──────────────────────────────────────────

def test_parse_lap_duration_plain():
    assert _parse_lap_duration("60.0") == pytest.approx(60.0)


def test_parse_lap_duration_min_sec():
    assert _parse_lap_duration("1:30.500") == pytest.approx(90.5)


# ── _format_lap_time ─────────────────────────────────────────────

def test_format_lap_time():
    assert _format_lap_time(90.5) == "1:30.500"


def test_format_lap_time_zero():
    assert _format_lap_time(0) == "0:00.000"


# ── _format_value ────────────────────────────────────────────────

def test_format_value_time():
    assert _format_value("Time", 1.23456) == "1.235"


def test_format_value_gps():
    assert _format_value("GPS Latitude", 23.12345678) == "23.12345678"


def test_format_value_gps_nsat():
    assert _format_value("GPS Nsat", 12.0) == "12"


def test_format_value_default():
    assert _format_value("Speed", 1.23456) == "1.2346"


def test_format_value_nan():
    assert _format_value("Speed", float("nan")) == ""


# ── _laps_from_metadata ──────────────────────────────────────────

def test_laps_empty():
    assert _laps_from_metadata({}) == []


def test_laps_single():
    laps = _laps_from_metadata({"Segment Times": "1:30.000"})
    assert len(laps) == 1
    assert laps[0].start == 0.0
    assert laps[0].duration == pytest.approx(90.0)


def test_laps_multiple():
    laps = _laps_from_metadata({"Segment Times": "60.0;60.0;60.0"})
    assert len(laps) == 3
    assert laps[0].start == 0.0
    assert laps[1].start == pytest.approx(60.0)
    assert laps[2].start == pytest.approx(120.0)


# ── _read_text ───────────────────────────────────────────────────

def test_read_text_utf8():
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="w", encoding="utf-8") as f:
        f.write("hello,world\n")
        temp_path = f.name
    try:
        result = _read_text(Path(temp_path))
        assert "hello,world" in result
    finally:
        Path(temp_path).unlink()


def test_read_text_utf8_bom():
    content = "hello,world\n"
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="wb") as f:
        f.write(b"\xef\xbb\xbf" + content.encode("utf-8"))
        temp_path = f.name
    try:
        result = _read_text(Path(temp_path))
        assert "hello,world" in result
    finally:
        Path(temp_path).unlink()


# ── _read_csv_rows ───────────────────────────────────────────────

def test_read_csv_rows_comma():
    text = "Session,Test\n\nTime,Speed,RPM\ns,km/h,rpm\n\n0.0,10.0,1000\n"
    rows = _read_csv_rows(text)
    assert rows


def test_read_csv_rows_semicolon():
    text = "Session;Test\n\nTime;Speed;RPM\ns;km/h;rpm\n\n0.0;10.0;1000\n"
    rows = _read_csv_rows(text)
    assert rows


def test_read_csv_rows_tab():
    text = "Session\tTest\n\nTime\tSpeed\tRPM\ns\tkm/h\trpm\n\n0.0\t10.0\t1000\n"
    rows = _read_csv_rows(text)
    assert rows


# ── parse_csv (integration) ──────────────────────────────────────

def _write_minimal_csv(path: Path):
    """Write a minimal valid RaceStudio-like CSV."""
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
        w.writerow(["Session", "Test Session"])
        w.writerow(["Vehicle", "TestCar"])
        w.writerow(["Racer", "TestDriver"])
        w.writerow(["Date", "2026-05-13"])
        w.writerow(["Time", "14:30:00"])
        w.writerow(["Duration", "60.0"])
        w.writerow([])
        w.writerow(["Time", "Speed", "RPM"])
        w.writerow(["s", "km/h", "rpm"])
        w.writerow([])
        w.writerow(["0.0", "0.0", "1000"])
        w.writerow(["0.05", "10.0", "1100"])
        w.writerow(["0.10", "20.0", "1200"])
        w.writerow(["0.15", "30.0", "1300"])


class TestParseCsv:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmp = tempfile.mkdtemp()
        self.csv_path = Path(self.tmp) / "test.csv"
        _write_minimal_csv(self.csv_path)
        self.dataset = parse_csv(self.csv_path)
        yield
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_has_id(self):
        assert self.dataset.id

    def test_has_meta(self):
        assert self.dataset.meta.vehicle == "TestCar"
        assert self.dataset.meta.racer == "TestDriver"

    def test_has_channels(self):
        assert "Time" in self.dataset.channels
        assert "Speed" in self.dataset.channels
        assert "RPM" in self.dataset.channels

    def test_channel_dtype(self):
        assert self.dataset.channels["Time"].dtype == "time"
        assert self.dataset.channels["Speed"].dtype == "numeric"

    def test_frame_shape(self):
        assert len(self.dataset.frame) == 4  # 4 data rows

    def test_time_normalized(self):
        assert self.dataset.frame["Time"].iloc[0] == 0.0


# ── export_racestudio_like_csv ───────────────────────────────────

def test_export_roundtrip():
    tmp = tempfile.mkdtemp()
    try:
        src = Path(tmp) / "src.csv"
        dst = Path(tmp) / "dst.csv"
        _write_minimal_csv(src)
        dataset = parse_csv(src)
        export_racestudio_like_csv(dataset, dst)
        dataset2 = parse_csv(dst)
        assert dataset2.meta.vehicle == dataset.meta.vehicle
        assert len(dataset2.frame) == len(dataset.frame)
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def test_export_with_comment_override():
    tmp = tempfile.mkdtemp()
    try:
        src = Path(tmp) / "src.csv"
        dst = Path(tmp) / "dst.csv"
        _write_minimal_csv(src)
        dataset = parse_csv(src)
        export_racestudio_like_csv(dataset, dst, comment_override="custom comment")
        dataset2 = parse_csv(dst)
        assert dataset2.meta.comment == "custom comment"
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


def test_parse_csv_duplicate_columns():
    tmp = tempfile.mkdtemp()
    try:
        path = Path(tmp) / "dup.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
            w.writerow([])
            w.writerow(["Time", "X", "X"])
            w.writerow(["s", "m", "m"])
            w.writerow([])
            w.writerow(["0.0", "1.0", "2.0"])
        dataset = parse_csv(path)
        assert dataset.header_order == ["Time", "X", "X (2)"]
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
