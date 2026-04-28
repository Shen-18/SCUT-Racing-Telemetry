from __future__ import annotations

import hashlib
import re
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from .parser import export_racestudio_like_csv, load_telemetry
from .settings import default_library_root


SUPPORTED_LIBRARY_SUFFIXES = {".xrk", ".csv"}
SUPPORTED_IMPORT_SUFFIXES = SUPPORTED_LIBRARY_SUFFIXES | {".zip"}


@dataclass(frozen=True)
class RunRecord:
    id: str
    file_hash: str
    original_name: str
    original_path: str
    stored_path: str
    file_type: str
    imported_at: str
    run_datetime: str
    duration: float
    driver: str
    vehicle: str
    note_title: str = ""
    note_body: str = ""


@dataclass(frozen=True)
class ImportSummary:
    imported: int
    skipped: int
    failed: int
    errors: tuple[str, ...] = ()


@dataclass(frozen=True)
class DateNote:
    date_label: str
    note_title: str = ""
    note_body: str = ""


@dataclass(frozen=True)
class ImportEntry:
    path: Path
    zip_member: str | None = None

    @property
    def label(self) -> str:
        return Path(self.zip_member).name if self.zip_member else self.path.name


class TelemetryLibrary:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_library_root()
        self.files_dir = self.root / "files"
        self.db_path = self.root / "library.db"
        self.root.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    file_hash TEXT NOT NULL UNIQUE,
                    original_name TEXT NOT NULL,
                    original_path TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    run_datetime TEXT NOT NULL,
                    duration REAL NOT NULL,
                    driver TEXT NOT NULL,
                    vehicle TEXT NOT NULL,
                    note_title TEXT NOT NULL DEFAULT '',
                    note_body TEXT NOT NULL DEFAULT ''
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_datetime ON runs(run_datetime)")
            self._ensure_column(conn, "note_title", "TEXT NOT NULL DEFAULT ''")
            self._ensure_column(conn, "note_body", "TEXT NOT NULL DEFAULT ''")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS date_notes (
                    date_label TEXT PRIMARY KEY,
                    note_title TEXT NOT NULL DEFAULT '',
                    note_body TEXT NOT NULL DEFAULT ''
                )
                """
            )

    def _ensure_column(self, conn: sqlite3.Connection, name: str, ddl: str) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(runs)").fetchall()}
        if name not in existing:
            conn.execute(f"ALTER TABLE runs ADD COLUMN {name} {ddl}")

    def list_records(self) -> list[RunRecord]:
        with self._connection() as conn:
            rows = conn.execute("SELECT * FROM runs ORDER BY run_datetime DESC, imported_at DESC").fetchall()
        return [row_to_record(row) for row in rows]

    def get_record(self, record_id: str) -> RunRecord | None:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM runs WHERE id = ?", (record_id,)).fetchone()
        return row_to_record(row) if row else None

    def get_record_by_hash(self, file_hash: str) -> RunRecord | None:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM runs WHERE file_hash = ?", (file_hash,)).fetchone()
        return row_to_record(row) if row else None

    def existing_hashes(self) -> set[str]:
        with self._connection() as conn:
            rows = conn.execute("SELECT file_hash FROM runs").fetchall()
        return {row["file_hash"] for row in rows}

    def delete_record(self, record_id: str) -> None:
        with self._connection() as conn:
            conn.execute("DELETE FROM runs WHERE id = ?", (record_id,))

    def delete_records(self, record_ids: list[str]) -> int:
        if not record_ids:
            return 0
        with self._connection() as conn:
            conn.executemany("DELETE FROM runs WHERE id = ?", [(record_id,) for record_id in record_ids])
        return len(record_ids)

    def prune_missing_records(self) -> int:
        records = self.list_records()
        missing = [record.id for record in records if not Path(record.stored_path).exists()]
        return self.delete_records(missing)

    def repair_filename_metadata(self) -> int:
        records = self.list_records()
        updates: list[tuple[str, str, str, str]] = []
        for record in records:
            try:
                dataset = load_telemetry(record.stored_path)
            except Exception:
                continue
            driver = dataset.meta.racer.strip()
            vehicle = dataset.meta.vehicle.strip()
            run_datetime = session_datetime_text(dataset.meta.date, dataset.meta.start_time)
            if driver != record.driver or vehicle != record.vehicle or run_datetime != record.run_datetime:
                updates.append((driver, vehicle, run_datetime, record.id))
        if not updates:
            return 0
        with self._connection() as conn:
            conn.executemany("UPDATE runs SET driver = ?, vehicle = ?, run_datetime = ? WHERE id = ?", updates)
        return len(updates)

    def update_note(self, record_id: str, title: str, body: str) -> None:
        with self._connection() as conn:
            conn.execute(
                "UPDATE runs SET note_title = ?, note_body = ? WHERE id = ?",
                (title.strip(), body.strip(), record_id),
            )

    def date_notes(self) -> dict[str, DateNote]:
        with self._connection() as conn:
            rows = conn.execute("SELECT * FROM date_notes").fetchall()
        return {row["date_label"]: DateNote(row["date_label"], row["note_title"], row["note_body"]) for row in rows}

    def get_date_note(self, date_label: str) -> DateNote:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM date_notes WHERE date_label = ?", (date_label,)).fetchone()
        if not row:
            return DateNote(date_label)
        return DateNote(row["date_label"], row["note_title"], row["note_body"])

    def update_date_note(self, date_label: str, title: str, body: str) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO date_notes (date_label, note_title, note_body)
                VALUES (?, ?, ?)
                ON CONFLICT(date_label) DO UPDATE SET
                    note_title = excluded.note_title,
                    note_body = excluded.note_body
                """,
                (date_label, title.strip(), body.strip()),
            )

    def export_records_zip(self, records: list[RunRecord], zip_path: Path, *, include_notes: bool = True) -> int:
        zip_path = Path(zip_path)
        zip_path.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        used_names: set[str] = set()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for record in records:
                    dataset = load_telemetry(record.stored_path)
                    dataset.meta.file_path = Path(record.original_name)
                    comment = record_note_text(record) if include_notes else None
                    name = unique_name(
                        safe_filename(f"{format_run_time(record.run_datetime)}_{Path(record.original_name).stem}.csv"),
                        used_names,
                    )
                    csv_path = tmp_dir / name
                    export_racestudio_like_csv(dataset, csv_path, comment_override=comment if comment else None)
                    archive.write(csv_path, name)
                    written += 1
        return written

    def import_paths(
        self,
        paths: list[Path],
        *,
        recursive: bool = False,
        progress: Callable[[int, int, str], None] | None = None,
    ) -> ImportSummary:
        entries = collect_import_entries(paths, recursive=recursive)
        imported = 0
        skipped = 0
        failed = 0
        errors: list[str] = []
        existing = self.existing_hashes()
        total = len(entries)
        for idx, entry in enumerate(entries, start=1):
            try:
                result = self._import_entry(entry, existing)
                if result:
                    imported += 1
                else:
                    skipped += 1
            except Exception as exc:
                failed += 1
                errors.append(f"{entry.label}: {exc}")
            if progress:
                progress(idx, total, entry.label)
        return ImportSummary(imported=imported, skipped=skipped, failed=failed, errors=tuple(errors[:8]))

    def _import_entry(self, entry: ImportEntry, existing_hashes: set[str] | None = None) -> bool:
        if not entry.zip_member:
            return self.import_file(entry.path, existing_hashes=existing_hashes)
        if entry.zip_member == "__BAD_ZIP__":
            raise ValueError("压缩包损坏或无法读取")
        with zipfile.ZipFile(entry.path) as archive, tempfile.TemporaryDirectory() as tmp:
            info = archive.getinfo(entry.zip_member)
            suffix = Path(info.filename).suffix.lower()
            temp_name = safe_filename(Path(info.filename).stem) + suffix
            temp_path = Path(tmp) / temp_name
            with archive.open(info) as source, temp_path.open("wb") as target:
                shutil.copyfileobj(source, target)
            return self.import_file(
                temp_path,
                original_name=Path(info.filename).name,
                original_path=f"{entry.path.resolve()}!{info.filename}",
                existing_hashes=existing_hashes,
            )

    def import_file(
        self,
        path: Path,
        *,
        original_name: str | None = None,
        original_path: str | None = None,
        existing_hashes: set[str] | None = None,
    ) -> bool:
        path = path.resolve()
        file_hash = sha256_file(path)
        if existing_hashes is not None and file_hash in existing_hashes:
            return False
        if existing_hashes is None:
            with self._connection() as conn:
                exists = conn.execute("SELECT 1 FROM runs WHERE file_hash = ?", (file_hash,)).fetchone()
            if exists:
                return False

        dataset = load_telemetry(path)
        suffix = path.suffix.lower()
        stored_rel = Path(file_hash[:2]) / f"{file_hash}{suffix}"
        stored_path = self.files_dir / stored_rel
        stored_path.parent.mkdir(parents=True, exist_ok=True)
        if not stored_path.exists():
            shutil.copy2(path, stored_path)

        run_datetime = session_datetime_text(dataset.meta.date, dataset.meta.start_time)
        driver = dataset.meta.racer.strip()
        vehicle = dataset.meta.vehicle.strip()
        note_title, note_body = note_from_comment(dataset.meta.comment)
        record = RunRecord(
            id=file_hash,
            file_hash=file_hash,
            original_name=original_name or path.name,
            original_path=original_path or str(path),
            stored_path=str(stored_path),
            file_type=suffix.lstrip("."),
            imported_at=datetime.now().isoformat(timespec="seconds"),
            run_datetime=run_datetime,
            duration=float(dataset.meta.duration or dataset.max_time or 0.0),
            driver=driver,
            vehicle=vehicle,
            note_title=note_title,
            note_body=note_body,
        )
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO runs (
                    id, file_hash, original_name, original_path, stored_path, file_type,
                    imported_at, run_datetime, duration, driver, vehicle, note_title, note_body
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.id,
                    record.file_hash,
                    record.original_name,
                    record.original_path,
                    record.stored_path,
                    record.file_type,
                    record.imported_at,
                    record.run_datetime,
                    record.duration,
                    record.driver,
                    record.vehicle,
                    record.note_title,
                    record.note_body,
                ),
            )
        if existing_hashes is not None:
            existing_hashes.add(file_hash)
        return True

def expand_import_paths(paths: list[Path], *, recursive: bool = False) -> list[Path]:
    return [entry.path for entry in collect_import_entries(paths, recursive=recursive) if not entry.zip_member]


def collect_import_entries(paths: list[Path], *, recursive: bool = False) -> list[ImportEntry]:
    result: list[Path] = []
    seen: set[Path] = set()
    for raw in paths:
        path = Path(raw)
        candidates = path.rglob("*") if path.is_dir() and recursive else (path.iterdir() if path.is_dir() else [path])
        for candidate in candidates:
            if not candidate.is_file() or candidate.suffix.lower() not in SUPPORTED_IMPORT_SUFFIXES:
                continue
            resolved = candidate.resolve()
            if resolved not in seen:
                seen.add(resolved)
                result.append(resolved)
    entries: list[ImportEntry] = []
    for path in result:
        if path.suffix.lower() == ".zip":
            try:
                entries.extend(zip_import_entries(path))
            except zipfile.BadZipFile:
                entries.append(ImportEntry(path, "__BAD_ZIP__"))
        else:
            entries.append(ImportEntry(path))
    return entries


def zip_import_entries(path: Path) -> list[ImportEntry]:
    entries: list[ImportEntry] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            if Path(info.filename).suffix.lower() not in SUPPORTED_LIBRARY_SUFFIXES:
                continue
            entries.append(ImportEntry(path, info.filename))
    return entries


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def note_from_comment(comment: str) -> tuple[str, str]:
    text = (comment or "").strip()
    if not text:
        return "", ""
    title_match = re.search(
        r"(?:^|[;\n；])\s*(?:备注标题|标题|Title)\s*[:：]\s*(.*?)(?=\s*(?:[;\n；]\s*(?:备注内容|内容|Body)\s*[:：]|$))",
        text,
        flags=re.IGNORECASE,
    )
    body_match = re.search(r"(?:^|[;\n；])\s*(?:备注内容|内容|Body)\s*[:：]\s*([\s\S]*)", text, flags=re.IGNORECASE)
    if title_match or body_match:
        title = title_match.group(1).strip() if title_match else ""
        body = body_match.group(1).strip() if body_match else ""
        body = body.replace("\\n", "\n")
        return title[:80], body
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), text)
    return first_line[:80], text


def record_note_text(record: RunRecord) -> str:
    title = (record.note_title or "").strip()
    body = (record.note_body or "").strip()
    body_export = body.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n")
    if title and body:
        return f"备注标题：{title}；备注内容：{body_export}"
    if title:
        return f"备注标题：{title}"
    if body:
        return f"备注内容：{body_export}"
    return ""


def safe_filename(text: str) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(text).strip())
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:150] or "export"


def unique_name(name: str, used: set[str]) -> str:
    path = Path(name)
    stem = path.stem
    suffix = path.suffix
    candidate = name
    idx = 2
    while candidate.lower() in used:
        candidate = f"{stem}_{idx}{suffix}"
        idx += 1
    used.add(candidate.lower())
    return candidate


def session_datetime(date_text: str, time_text: str, fallback_path: Path) -> datetime:
    date_text = (date_text or "").strip()
    time_text = (time_text or "").strip()
    candidates = [
        f"{date_text} {time_text}".strip(),
        date_text,
    ]
    formats = [
        "%A, %B %d, %Y %I:%M %p",
        "%A, %B %d, %Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%A, %B %d, %Y",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ]
    for candidate in candidates:
        for fmt in formats:
            try:
                parsed = datetime.strptime(candidate, fmt)
                if parsed.year >= 2000:
                    return parsed
            except ValueError:
                continue
    return datetime.fromtimestamp(fallback_path.stat().st_mtime)


def session_datetime_text(date_text: str, time_text: str) -> str:
    date_text = (date_text or "").strip()
    time_text = (time_text or "").strip()
    if not date_text and not time_text:
        return ""
    candidates = [
        f"{date_text} {time_text}".strip(),
        date_text,
    ]
    formats = [
        "%A, %B %d, %Y %I:%M %p",
        "%A, %B %d, %Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
        "%A, %B %d, %Y",
        "%Y-%m-%d",
        "%Y/%m/%d",
    ]
    for candidate in candidates:
        for fmt in formats:
            try:
                parsed = datetime.strptime(candidate, fmt)
                if parsed.year >= 2000:
                    return parsed.isoformat(timespec="seconds")
            except ValueError:
                continue
    return ""


def format_chinese_date(iso_text: str) -> str:
    if not iso_text:
        return "未填写日期"
    try:
        dt = datetime.fromisoformat(iso_text)
    except ValueError:
        return "未填写日期"
    return f"{dt.year}年{dt.month}月{dt.day}日"


def format_run_time(iso_text: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_text)
    except ValueError:
        return ""
    return dt.strftime("%H:%M")


def guess_driver(path: Path) -> str:
    return ""


def guess_vehicle(path: Path) -> str:
    return ""


def row_to_record(row: sqlite3.Row) -> RunRecord:
    return RunRecord(
        id=row["id"],
        file_hash=row["file_hash"],
        original_name=row["original_name"],
        original_path=row["original_path"],
        stored_path=row["stored_path"],
        file_type=row["file_type"],
        imported_at=row["imported_at"],
        run_datetime=row["run_datetime"],
        duration=float(row["duration"]),
        driver=row["driver"],
        vehicle=row["vehicle"],
        note_title=row["note_title"] if "note_title" in row.keys() else "",
        note_body=row["note_body"] if "note_body" in row.keys() else "",
    )
