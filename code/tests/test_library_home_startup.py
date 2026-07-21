from __future__ import annotations

import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from scut_telemetry.ui.library_home import LibraryHome


def _app() -> QApplication:
    return QApplication.instance() or QApplication([])


class FastStartupLibrary:
    def __init__(self) -> None:
        self.repair_called = False

    def prune_missing_records(self) -> int:
        return 0

    def repair_filename_metadata(self) -> int:
        self.repair_called = True
        raise AssertionError("deep metadata repair must not run during startup")

    def list_records(self):
        return []

    def date_notes(self):
        return {}


def test_library_home_startup_uses_shallow_refresh_only() -> None:
    _app()
    library = FastStartupLibrary()
    LibraryHome(library)  # type: ignore[arg-type]
    assert library.repair_called is False

