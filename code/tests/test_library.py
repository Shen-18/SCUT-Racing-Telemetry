"""Tests for scut_telemetry.library — SQLite-backed telemetry file management."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from scut_telemetry.library import (
    note_from_comment,
    record_note_text,
    safe_filename,
    unique_name,
    sha256_file,
    session_datetime,
    session_datetime_text,
    format_chinese_date,
    format_run_time,
    row_to_record,
    ImportEntry,
    ImportSummary,
    RunRecord,
    TelemetryLibrary,
)


# ── note_from_comment ────────────────────────────────────────────

def test_note_empty():
    assert note_from_comment("") == ("", "")
    assert note_from_comment("   ") == ("", "")


def test_note_structured_title_body():
    text = "备注标题：测试标题；备注内容：测试内容"
    title, body = note_from_comment(text)
    assert title == "测试标题"
    assert body == "测试内容"


def test_note_structured_english_keys():
    text = "Title: Test Title; Body: Test Body"
    title, body = note_from_comment(text)
    assert title == "Test Title"
    assert body == "Test Body"


def test_note_title_only():
    text = "备注标题：Only Title"
    title, body = note_from_comment(text)
    assert title == "Only Title"
    assert body == ""


def test_note_body_only():
    text = "备注内容：Only Body"
    title, body = note_from_comment(text)
    assert title == ""
    assert body == "Only Body"


def test_note_title_truncation():
    long_title = "A" * 100
    text = f"备注标题：{long_title}；备注内容：body"
    title, body = note_from_comment(text)
    assert len(title) == 80
    assert body == "body"


def test_note_comment_block():
    text = "--- 评论 ---[2026/5/13 14:30:00] Alice: hello"
    title, body = note_from_comment(text)
    assert title == ""
    assert body == text


def test_note_structured_comment_without_header():
    text = "[2026/5/13 14:30] Alice: inline comment"
    title, body = note_from_comment(text)
    assert title == ""
    assert body == text


def test_note_first_line_fallback():
    text = "just a plain comment\nwith multiple lines"
    title, body = note_from_comment(text)
    assert title == "just a plain comment"
    assert body == text


def test_note_newline_unescape():
    text = r"备注标题：Title；备注内容：line1\nline2"
    title, body = note_from_comment(text)
    assert body == "line1\nline2"


# ── record_note_text ─────────────────────────────────────────────

def test_record_note_both():
    record = RunRecord(
        id="x", file_hash="x", original_name="x", original_path="x",
        stored_path="x", file_type="csv", imported_at="2026-01-01T00:00:00",
        run_datetime="2026-01-01T00:00:00", duration=0, driver="", vehicle="",
        note_title="Title", note_body="Body",
    )
    assert "备注标题：Title" in record_note_text(record)
    assert "备注内容：Body" in record_note_text(record)


def test_record_note_pure_comments():
    record = RunRecord(
        id="x", file_hash="x", original_name="x", original_path="x",
        stored_path="x", file_type="csv", imported_at="2026-01-01T00:00:00",
        run_datetime="2026-01-01T00:00:00", duration=0, driver="", vehicle="",
        note_title="", note_body="--- 评论 ---[2026/5/13 14:30:00] Alice: hello",
    )
    result = record_note_text(record)
    assert result == "--- 评论 ---[2026/5/13 14:30:00] Alice: hello"


def test_record_note_empty():
    record = RunRecord(
        id="x", file_hash="x", original_name="x", original_path="x",
        stored_path="x", file_type="csv", imported_at="2026-01-01T00:00:00",
        run_datetime="2026-01-01T00:00:00", duration=0, driver="", vehicle="",
        note_title="", note_body="",
    )
    assert record_note_text(record) == ""


# ── safe_filename ────────────────────────────────────────────────

def test_safe_filename_normal():
    assert safe_filename("test.csv") == "test.csv"


def test_safe_filename_illegal_chars():
    result = safe_filename('file<name>"with|chars?')
    assert '<' not in result
    assert '"' not in result
    assert '|' not in result


def test_safe_filename_trim():
    assert safe_filename("  padded  .") == "padded"


def test_safe_filename_long():
    long_name = "a" * 200 + ".csv"
    result = safe_filename(long_name)
    assert len(result) <= 150


# ── unique_name ──────────────────────────────────────────────────

def test_unique_name_no_collision():
    used: set[str] = set()
    assert unique_name("file.csv", used) == "file.csv"


def test_unique_name_collision():
    used = {"file.csv"}
    assert unique_name("file.csv", used) == "file_2.csv"


def test_unique_name_case_insensitive():
    # unique_name lowercases when adding to used, so pre-lowercase the set
    used = {"file.csv"}
    result = unique_name("FILE.CSV", used)
    assert result != "FILE.CSV"


def test_unique_name_multiple():
    used = {"file.csv", "file_2.csv", "file_3.csv"}
    assert unique_name("file.csv", used) == "file_4.csv"


# ── sha256_file ──────────────────────────────────────────────────

def test_sha256_file():
    with tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="w") as f:
        f.write("hello,world\n1,2\n")
        temp_path = f.name
    try:
        digest = sha256_file(Path(temp_path))
        assert len(digest) == 64
        assert all(c in "0123456789abcdef" for c in digest)
    finally:
        Path(temp_path).unlink()


# ── session_datetime ─────────────────────────────────────────────

def test_session_datetime_iso():
    result = session_datetime("2026-05-13", "14:30:00", Path("/dev/null"))
    assert result.year == 2026
    assert result.month == 5
    assert result.day == 13


def test_session_datetime_racestudio_format():
    result = session_datetime("Wednesday, May 13, 2026", "02:30 PM", Path("/dev/null"))
    assert result.year == 2026


def test_session_datetime_fallback():
    import time
    temp = Path(tempfile.gettempdir()) / "dummy_for_mtime_test.txt"
    temp.write_text("x")
    try:
        result = session_datetime("garbage", "garbage", temp)
        # should fall back to file mtime
        assert result.year >= 2020
    finally:
        temp.unlink(missing_ok=True)


# ── session_datetime_text ────────────────────────────────────────

def test_session_datetime_text_valid():
    result = session_datetime_text("2026-05-13", "14:30:00")
    assert result == "2026-05-13T14:30:00"


def test_session_datetime_text_empty():
    assert session_datetime_text("", "") == ""


# ── format_chinese_date ──────────────────────────────────────────

def test_format_chinese_date_valid():
    assert format_chinese_date("2026-05-13T14:30:00") == "2026年5月13日"


def test_format_chinese_date_empty():
    assert format_chinese_date("") == "未填写日期"


def test_format_chinese_date_invalid():
    assert format_chinese_date("not-a-date") == "未填写日期"


# ── format_run_time ──────────────────────────────────────────────

def test_format_run_time_valid():
    assert format_run_time("2026-05-13T14:30:00") == "14:30"


def test_format_run_time_invalid():
    assert format_run_time("") == ""


# ── ImportEntry ─────────────────────────────────────────────────

def test_import_entry_label_plain():
    entry = ImportEntry(Path("/tmp/test.csv"))
    assert entry.label == "test.csv"


def test_import_entry_label_zip():
    entry = ImportEntry(Path("/tmp/archive.zip"), "subdir/data.xrk")
    assert entry.label == "data.xrk"


# ── TelemetryLibrary (light integration) ─────────────────────────

class TestTelemetryLibrary:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.tmp = tempfile.mkdtemp()
        self.lib = TelemetryLibrary(Path(self.tmp))
        yield
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_init_creates_db(self):
        assert (Path(self.tmp) / "library.db").exists()

    def test_empty_records(self):
        assert self.lib.list_records() == []

    def test_existing_hashes_empty(self):
        assert self.lib.existing_hashes() == set()

    def test_get_record_nonexistent(self):
        assert self.lib.get_record("nonexistent") is None

    def test_get_record_by_hash_nonexistent(self):
        assert self.lib.get_record_by_hash("deadbeef") is None

    def test_date_notes_empty(self):
        assert self.lib.date_notes() == {}

    def test_update_date_note(self):
        self.lib.update_date_note("2026-05-13", "Title", "Body")
        note = self.lib.get_date_note("2026-05-13")
        assert note.note_title == "Title"
        assert note.note_body == "Body"

    def test_update_date_note_overwrite(self):
        self.lib.update_date_note("2026-05-13", "T1", "B1")
        self.lib.update_date_note("2026-05-13", "T2", "B2")
        note = self.lib.get_date_note("2026-05-13")
        assert note.note_title == "T2"

    def test_get_date_note_default(self):
        note = self.lib.get_date_note("2026-05-13")
        assert note.note_title == ""
        assert note.note_body == ""

    def test_delete_record(self):
        self.lib.delete_record("nonexistent")

    def test_delete_records_empty(self):
        assert self.lib.delete_records([]) == 0

    def test_prune_missing_empty(self):
        assert self.lib.prune_missing_records() == 0

    def test_count_records_empty(self):
        assert self.lib.count_records() == 0

    def test_count_records_with_filter(self):
        # Import a temp CSV creates a record, then test filtering
        import csv, tempfile
        tmp = tempfile.mkdtemp()
        try:
            src = Path(tmp) / "count_test.csv"
            with src.open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
                w.writerow(["Racer", "TestDriver"])
                w.writerow(["Vehicle", "TestCar"])
                w.writerow(["Date", "2026-05-13"])
                w.writerow(["Time", "14:30:00"])
                w.writerow([])
                w.writerow(["Time", "Speed", "RPM"])
                w.writerow(["s", "km/h", "rpm"])
                w.writerow([])
                w.writerow(["0.0", "10.0", "1000"])
            self.lib.import_file(src)
            assert self.lib.count_records() == 1
            assert self.lib.count_records(driver="TestDriver") == 1
            assert self.lib.count_records(driver="Nonexistent") == 0
            assert self.lib.count_records(vehicle="TestCar") == 1
            assert self.lib.count_records(vehicle="Other") == 0
        finally:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)

    def test_list_records_paginated_basic(self):
        # Import a temp CSV, test pagination
        import csv, tempfile
        tmp = tempfile.mkdtemp()
        try:
            src = Path(tmp) / "page_test.csv"
            with src.open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
                w.writerow(["Racer", "TestDriver"])
                w.writerow(["Vehicle", "TestCar"])
                w.writerow(["Date", "2026-05-13"])
                w.writerow(["Time", "14:30:00"])
                w.writerow([])
                w.writerow(["Time", "Speed", "RPM"])
                w.writerow(["s", "km/h", "rpm"])
                w.writerow([])
                w.writerow(["0.0", "10.0", "1000"])
            self.lib.import_file(src)
            page = self.lib.list_records_paginated(offset=0, limit=10)
            assert len(page) == 1
            assert page[0].driver == "TestDriver"
            page = self.lib.list_records_paginated(offset=10, limit=10)
            assert len(page) == 0
        finally:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)

    def test_list_records_paginated_filter(self):
        import csv, tempfile
        tmp = tempfile.mkdtemp()
        try:
            src = Path(tmp) / "filter_test.csv"
            with src.open("w", encoding="utf-8-sig", newline="") as f:
                w = csv.writer(f, quoting=csv.QUOTE_ALL, lineterminator="\n")
                w.writerow(["Racer", "DriverA"])
                w.writerow(["Vehicle", "CarX"])
                w.writerow(["Date", "2026-05-13"])
                w.writerow(["Time", "14:30:00"])
                w.writerow([])
                w.writerow(["Time", "Speed", "RPM"])
                w.writerow(["s", "km/h", "rpm"])
                w.writerow([])
                w.writerow(["0.0", "10.0", "1000"])
            self.lib.import_file(src)
            page = self.lib.list_records_paginated(offset=0, limit=10, driver="DriverA", vehicle="CarX")
            assert len(page) == 1
            page = self.lib.list_records_paginated(offset=0, limit=10, driver="DriverB")
            assert len(page) == 0
        finally:
            import shutil
            shutil.rmtree(tmp, ignore_errors=True)

    def test_list_records_paginated_empty(self):
        assert self.lib.list_records_paginated() == []

    def test_new_indexes_exist(self):
        with self.lib._connect() as conn:
            indexes = {row[1] for row in conn.execute("PRAGMA index_list(runs)").fetchall()}
        assert "idx_runs_datetime_imported" in indexes
        assert "idx_runs_driver" in indexes
        assert "idx_runs_vehicle" in indexes
