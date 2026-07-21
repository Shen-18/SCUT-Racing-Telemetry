from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QThread, Signal

from ..library import TelemetryLibrary


class LibraryImportWorker(QThread):
    importCompleted = Signal(object)
    progressChanged = Signal(int, int, str)

    def __init__(self, library: TelemetryLibrary, paths: list[Path], recursive: bool = False) -> None:
        super().__init__()
        self.library = library
        self.paths = paths
        self.recursive = recursive

    def run(self) -> None:
        summary = self.library.import_paths(
            self.paths,
            recursive=self.recursive,
            progress=lambda done, total, label: self.progressChanged.emit(done, total, label),
        )
        self.importCompleted.emit(summary)


class _CallableWorker(QThread):
    """Generic QThread that runs a callable with *args. Emits result or exception."""
    finishedResult = Signal(object)

    def __init__(self, fn, *args, parent=None):
        super().__init__(parent)
        self._fn = fn
        self._args = args

    def run(self) -> None:
        try:
            result = self._fn(*self._args)
        except Exception as exc:
            result = exc
        self.finishedResult.emit(result)


class AutoAlignWorker(QThread):
    finishedResult = Signal(float)

    def __init__(self, dataset_a, dataset_b, channel, window, parent=None):
        super().__init__(parent)
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self.channel = channel
        self.window = window

    def run(self) -> None:
        from ..analyzer import estimate_offset

        offset = estimate_offset(self.dataset_a, self.dataset_b, self.channel, self.window)
        self.finishedResult.emit(offset)
