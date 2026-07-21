from __future__ import annotations

import sys
import time
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QApplication,
    QComboBox,
    QDialog,
    QDoubleSpinBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSlider,
    QSplitter,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..library import (
    TelemetryLibrary,
    expand_import_paths,
    record_note_text,
    sha256_file,
)
from ..models import TelemetryDataset, TimeWindow
from ..settings import current_display_profile, load_settings, save_settings
from .channel_list import ChannelList
from .dialogs import LibraryRunDialog, SettingsDialog
from .formatting import format_value
from .library_home import LibraryHome
from .plot_stack import TelemetryPlotStack
from .theme import DARK, LIGHT, Theme, apply_theme
from .timeline import TimelineWidget
from .track_panel import TrackPanel
from .workers import AutoAlignWorker, _CallableWorker

SUPPORTED_TELEMETRY_SUFFIXES = {".xrk", ".csv", ".zip"}


def app_icon_path() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [
        Path(getattr(sys, "_MEIPASS", "")) / "Data" / "SCUTRacing.ico" if getattr(sys, "frozen", False) else Path(),
        Path(sys.executable).resolve().parent / "Data" / "SCUTRacing.ico" if getattr(sys, "frozen", False) else Path(),
        Path(sys.executable).resolve().parent / "_internal" / "Data" / "SCUTRacing.ico" if getattr(sys, "frozen", False) else Path(),
        here.parents[3] / "Data" / "SCUTRacing.ico",
        here.parents[2] / "Data" / "SCUTRacing.ico",
        Path.cwd().parent / "Data" / "SCUTRacing.ico",
        Path.cwd() / "Data" / "SCUTRacing.ico",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("SCUT 赛车遥测数据分析")
        self.setAcceptDrops(True)
        self.settings = load_settings()
        icon_path = app_icon_path()
        if icon_path:
            self.setWindowIcon(QIcon(str(icon_path)))
        self.theme = LIGHT if self.settings.default_theme == "light" else DARK
        self.display_profile = current_display_profile(self.settings)
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.current_window = TimeWindow(0.0, 1.0)
        self.cursor_time = 0.0
        self.offset_b = 0.0
        self._syncing_offset = False
        self._last_detail_update = 0.0
        self._detail_update_interval = 0.15
        self.library = TelemetryLibrary(Path(self.settings.library_root))
        self.home_page = LibraryHome(self.library, self.display_profile, self.settings)
        self.home_page.recursive_check.setChecked(self.settings.recursive_import)

        self.channel_list = ChannelList()
        self.channel_list.apply_metadata_settings(
            self.settings.metadata_panel_expanded,
            self.settings.metadata_panel_fields,
        )
        self.plot_stack = TelemetryPlotStack()
        self.timeline = TimelineWidget()
        self.track_panel = TrackPanel()
        self.time_label = QLabel("当前时间 0.000 s")
        self.time_label.setObjectName("TimeBadge")
        self.time_label.setAlignment(Qt.AlignCenter)
        self.time_label.setMinimumWidth(138)
        self.status_label = QLabel("就绪")
        self.status_label.setObjectName("Muted")

        self._build_toolbar()
        self._build_layout()
        self._connect()
        self._apply_theme()

    # ── toolbar ──────────────────────────────────────────

    def _build_toolbar(self) -> None:
        self.top_bar = QFrame()
        self.top_bar.setObjectName("TopBar")
        toolbar = QHBoxLayout(self.top_bar)
        toolbar.setContentsMargins(8, 6, 8, 6)
        toolbar.setSpacing(6)

        back_home = QPushButton("返回主页")
        back_home.clicked.connect(self.show_home)
        load_a = QPushButton("打开文件 A")
        load_a.clicked.connect(lambda: self.open_file("A"))
        load_b = QPushButton("打开文件 B")
        load_b.clicked.connect(lambda: self.open_file("B"))
        toolbar.addWidget(back_home)
        toolbar.addWidget(load_a)
        toolbar.addWidget(load_b)

        self.compare_controls = QFrame()
        self.compare_controls.setObjectName("ToolGroup")
        compare_layout = QHBoxLayout(self.compare_controls)
        compare_layout.setContentsMargins(8, 0, 8, 0)
        compare_layout.setSpacing(6)
        compare_layout.addWidget(QLabel("对比模式"))
        self.compare_combo = QComboBox()
        self.compare_combo.addItems(["叠图", "分图"])
        compare_layout.addWidget(self.compare_combo)
        compare_layout.addWidget(QLabel("B 文件偏移"))
        self.offset_slider = QSlider(Qt.Horizontal)
        offset_range_ms = int(round(self.settings.default_compare_offset_range_seconds * 1000))
        self.offset_slider.setRange(-offset_range_ms, offset_range_ms)
        self.offset_slider.setFixedWidth(140)
        self.offset_spin = QDoubleSpinBox()
        self.offset_spin.setRange(
            -self.settings.default_compare_offset_range_seconds,
            self.settings.default_compare_offset_range_seconds,
        )
        self.offset_spin.setSingleStep(0.01)
        self.offset_spin.setDecimals(3)
        self.offset_spin.setSuffix(" s")
        compare_layout.addWidget(self.offset_slider)
        compare_layout.addWidget(self.offset_spin)
        self.auto_align_button = QPushButton("自动对齐")
        self.auto_align_button.clicked.connect(self.auto_align)
        self.exit_compare_button = QPushButton("退出对比")
        self.exit_compare_button.clicked.connect(self.exit_compare_mode)
        compare_layout.addWidget(self.auto_align_button)
        compare_layout.addWidget(self.exit_compare_button)
        toolbar.addWidget(self.compare_controls)

        toolbar.addStretch(1)
        export_png = QPushButton("导出 PNG")
        export_png.clicked.connect(self.export_png)
        export_view = QPushButton("导出当前视图 CSV")
        export_view.clicked.connect(self.export_view_csv)
        export_full = QPushButton("导出完整 CSV")
        export_full.clicked.connect(self.export_full_csv)
        toolbar.addWidget(export_png)
        toolbar.addWidget(export_view)
        toolbar.addWidget(export_full)
        toolbar.addWidget(self.status_label)
        self._update_compare_controls()

    # ── layout ───────────────────────────────────────────

    def _build_layout(self) -> None:
        self.analysis_page = QWidget()
        root = QVBoxLayout(self.analysis_page)
        root.setContentsMargins(4, 4, 4, 4)
        root.setSpacing(4)
        root.addWidget(self.top_bar, 0)
        center_column = QWidget()
        center_layout = QVBoxLayout(center_column)
        center_layout.setContentsMargins(0, 0, 0, 0)
        center_layout.setSpacing(4)
        time_row = QWidget()
        time_layout = QHBoxLayout(time_row)
        time_layout.setContentsMargins(0, 0, 0, 0)
        time_layout.addStretch(1)
        time_layout.addWidget(self.time_label)
        time_layout.addStretch(1)
        center_layout.addWidget(time_row, 0)
        center_layout.addWidget(self.plot_stack, 1)
        center_layout.addWidget(self.timeline, 0)

        horizontal = QSplitter(Qt.Horizontal)
        horizontal.addWidget(self.channel_list)
        horizontal.addWidget(center_column)
        horizontal.addWidget(self.track_panel)
        horizontal.setOpaqueResize(False)
        horizontal.setChildrenCollapsible(False)
        horizontal.setSizes(
            [
                self.settings.analysis_channel_width,
                self.settings.analysis_plot_width,
                self.settings.analysis_detail_width,
            ]
        )
        horizontal.setStretchFactor(0, 0)
        horizontal.setStretchFactor(1, 1)
        horizontal.setStretchFactor(2, 0)
        root.addWidget(horizontal, 1)

        self.stack = QStackedWidget()
        self.stack.addWidget(self.home_page)
        self.stack.addWidget(self.analysis_page)
        self.setCentralWidget(self.stack)

    # ── connections ──────────────────────────────────────

    def _connect(self) -> None:
        self.channel_list.selectionChanged.connect(self.refresh_all)
        self.compare_combo.currentTextChanged.connect(lambda _: self.refresh_all())
        self.plot_stack.cursorChanged.connect(self.set_cursor)
        self.plot_stack.zoomChanged.connect(self._zoom_window)
        self.timeline.cursorChanged.connect(self.set_cursor)
        self.timeline.rangeChanged.connect(self.preview_window)
        self.timeline.rangeChangeFinished.connect(self.set_window)
        self.offset_slider.valueChanged.connect(self._offset_slider_changed)
        self.offset_spin.valueChanged.connect(self._offset_spin_changed)
        self.home_page.openRun.connect(self.open_library_run)
        self.home_page.compareRun.connect(self.compare_library_run)
        self.home_page.settingsRequested.connect(self.open_settings)

    # ── helpers ──────────────────────────────────────────

    def _update_compare_controls(self) -> None:
        has_b = self.dataset_b is not None
        self.compare_controls.setVisible(has_b)
        self.offset_slider.setEnabled(has_b)
        self.offset_spin.setEnabled(has_b)
        self.auto_align_button.setEnabled(has_b)
        self.exit_compare_button.setEnabled(has_b)

    def _apply_theme(self) -> None:
        apply_theme(QApplication.instance(), self.theme, self.display_profile)
        self.home_page.set_display_profile(self.display_profile)
        self.plot_stack.set_theme(self.theme)
        self.timeline.set_theme(self.theme)
        self.track_panel.set_theme(self.theme)

    # ── settings ─────────────────────────────────────────

    def open_settings(self) -> None:
        self.settings = load_settings()
        dialog = SettingsDialog(self.settings, self)
        if dialog.exec() != QDialog.Accepted:
            return
        new_settings = dialog.result_settings()
        if not new_settings.library_root:
            new_settings.library_root = self.settings.library_root

        old_root = Path(self.settings.library_root).resolve()
        new_root = Path(new_settings.library_root).resolve()
        self.settings = new_settings
        save_settings(self.settings)
        self.settings = load_settings()
        self.display_profile = current_display_profile(self.settings)
        offset_range_ms = int(round(self.settings.default_compare_offset_range_seconds * 1000))
        self.offset_slider.setRange(-offset_range_ms, offset_range_ms)
        self.offset_spin.setRange(
            -self.settings.default_compare_offset_range_seconds,
            self.settings.default_compare_offset_range_seconds,
        )
        self.offset_b = max(
            -self.settings.default_compare_offset_range_seconds,
            min(self.settings.default_compare_offset_range_seconds, self.offset_b),
        )
        self._set_offset_widgets(self.offset_b)

        new_theme = LIGHT if self.settings.default_theme == "light" else DARK
        if self.theme.name != new_theme.name:
            self.theme = new_theme
        self.home_page.recursive_check.setChecked(self.settings.recursive_import)
        self.home_page.set_settings(self.settings)
        self.channel_list.apply_metadata_settings(
            self.settings.metadata_panel_expanded,
            self.settings.metadata_panel_fields,
        )
        self._apply_theme()

        if new_root != old_root:
            self.library = TelemetryLibrary(new_root)
            self.home_page.library = self.library
            self.home_page.set_settings(self.settings)
            self.home_page.refresh_records()
            self.status_label.setText(f"资料库已切换到 {new_root}")

    # ── navigation ───────────────────────────────────────

    def show_home(self) -> None:
        self.home_page.refresh_records()
        self.stack.setCurrentWidget(self.home_page)

    def open_library_run(self, record_id: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            QMessageBox.warning(self, "记录不存在", "没有找到这条跑动记录。")
            self.home_page.refresh_records()
            return
        path = Path(record.stored_path)
        if not path.exists():
            QMessageBox.warning(self, "文件缺失", f"资料库文件不存在：\n{path}")
            return
        self.stack.setCurrentWidget(self.analysis_page)
        self.load_record("A", record)

    def compare_library_run(self, record_id: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        self.stack.setCurrentWidget(self.analysis_page)
        self.load_record("A", record)
        self.open_b_file()

    # ── file loading ─────────────────────────────────────

    def open_file(self, role: str) -> None:
        if role == "B":
            self.open_b_file()
            return
        filename, _ = QFileDialog.getOpenFileName(
            self,
            f"打开遥测文件 {role}",
            str(Path.cwd().parent / "Data"),
            "遥测文件 (*.xrk *.csv);;所有文件 (*.*)",
        )
        if not filename:
            return
        self.load_file_path(role, Path(filename))

    def open_b_file(self) -> None:
        records = self.library.list_records()
        if records:
            dialog = LibraryRunDialog(records, self.display_profile, self)
            if dialog.exec() != QDialog.Accepted:
                return
            if not dialog.external_requested and dialog.selected_record_id:
                record = self.library.get_record(dialog.selected_record_id)
                if record:
                    self.load_record("B", record)
                return
        filename, _ = QFileDialog.getOpenFileName(
            self,
            "打开遥测文件 B",
            str(Path.cwd().parent / "Data"),
            "遥测文件 (*.xrk *.csv);;所有文件 (*.*)",
        )
        if filename:
            self.import_external_b(Path(filename))

    def import_external_b(self, path: Path) -> None:
        self.status_label.setText(f"正在导入 B 文件 {path.name}...")
        QApplication.processEvents()
        try:
            self.library.import_file(path)
            record = self.library.get_record_by_hash(sha256_file(path.resolve()))
        except Exception as exc:
            QMessageBox.warning(self, "导入 B 文件失败", f"{path.name}\n\n{exc}\n\n将直接从外部文件加载。")
            self.load_file_path("B", path)
            return
        self.home_page.refresh_records()
        if record:
            self.load_record("B", record)
        else:
            self.load_file_path("B", path)

    def load_record(self, role: str, record) -> None:
        path = Path(record.stored_path)
        self.status_label.setText(f"正在加载 {record.original_name}...")
        self._loading_role = role
        self._loading_record = record
        from ..parser import load_telemetry

        self._load_worker = _CallableWorker(load_telemetry, path)
        self._load_worker.finishedResult.connect(self._on_load_record_done)
        self._load_worker.finished.connect(self._load_worker.deleteLater)
        self._load_worker.start()

    def _on_load_record_done(self, dataset_or_error) -> None:
        role = self._loading_role
        record = self._loading_record
        if isinstance(dataset_or_error, Exception):
            QMessageBox.critical(self, "加载失败", f"{record.original_name}\n\n{dataset_or_error}")
            self.status_label.setText("加载失败")
            return
        dataset = dataset_or_error
        dataset.meta.file_path = Path(record.original_name)
        if self.settings.export_notes_to_csv:
            note = record_note_text(record)
            if note:
                dataset.meta.comment = note
        if role == "A":
            self.record_a_id = record.id
        else:
            self.record_b_id = record.id
        self._set_dataset(role, dataset)

    def load_file_path(self, role: str, path: str | Path) -> None:
        path = Path(path)
        self.status_label.setText(f"正在加载 {path.name}...")
        self._loading_role = role
        self._loading_path = path
        from ..parser import load_telemetry

        self._load_file_worker = _CallableWorker(load_telemetry, path)
        self._load_file_worker.finishedResult.connect(self._on_load_file_done)
        self._load_file_worker.finished.connect(self._load_file_worker.deleteLater)
        self._load_file_worker.start()

    def _on_load_file_done(self, dataset_or_error) -> None:
        role = self._loading_role
        if isinstance(dataset_or_error, Exception):
            QMessageBox.critical(self, "加载失败", f"{self._loading_path.name}\n\n{dataset_or_error}")
            self.status_label.setText("加载失败")
            return
        dataset = dataset_or_error
        if role == "A":
            self.record_a_id = None
        else:
            self.record_b_id = None
        self._set_dataset(role, dataset)

    def _set_dataset(self, role: str, dataset: TelemetryDataset) -> None:
        if role == "A":
            self.dataset_a = dataset
            self.dataset_b = None
            self.record_b_id = None
            self.offset_b = 0.0
            self._set_offset_widgets(0.0)
        else:
            self.dataset_b = dataset
        self._update_compare_controls()
        self.channel_list.selectionChanged.disconnect(self.refresh_all)
        self.channel_list.set_datasets(self.dataset_a, self.dataset_b)
        self.channel_list.selectionChanged.connect(self.refresh_all)
        self.status_label.setText(f"已加载 {dataset.meta.file_path.name}")
        self.refresh_all(reset_window=True)

    def exit_compare_mode(self) -> None:
        if not self.dataset_b:
            return
        self.dataset_b = None
        self.offset_b = 0.0
        self._set_offset_widgets(0.0)
        self._update_compare_controls()
        self.channel_list.selectionChanged.disconnect(self.refresh_all)
        self.channel_list.set_datasets(self.dataset_a, None)
        self.channel_list.selectionChanged.connect(self.refresh_all)
        self.status_label.setText("已退出双文件对比")
        self.refresh_all(reset_window=True)

    # ── drag & drop ──────────────────────────────────────

    def dragEnterEvent(self, event) -> None:
        if self._dropped_paths(event.mimeData()):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event) -> None:
        if self._dropped_paths(event.mimeData()):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dropEvent(self, event) -> None:
        paths = self._dropped_paths(event.mimeData())
        if not paths:
            event.ignore()
            return
        event.acceptProposedAction()
        if self.stack.currentWidget() is self.home_page:
            self.home_page.import_paths(paths, recursive=self.home_page.recursive_check.isChecked())
            return
        if any(path.is_dir() or path.suffix.lower() == ".zip" for path in paths):
            self.show_home()
            self.home_page.import_paths(paths, recursive=self.home_page.recursive_check.isChecked())
            return
        files = expand_import_paths(paths, recursive=self.home_page.recursive_check.isChecked())
        if files:
            self.load_file_path("A", files[0])

    def _dropped_paths(self, mime_data) -> list[Path]:
        if not mime_data.hasUrls():
            return []
        paths: list[Path] = []
        for url in mime_data.urls():
            if not url.isLocalFile():
                continue
            path = Path(url.toLocalFile())
            if path.is_dir() or path.suffix.lower() in SUPPORTED_TELEMETRY_SUFFIXES:
                paths.append(path)
        return paths

    # ── refresh ──────────────────────────────────────────

    def refresh_all(self, reset_window: bool = False) -> None:
        selected = self.channel_list.selected_channels()
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        max_time = max(1.0, max_time)
        if reset_window:
            self.current_window = TimeWindow(0.0, max_time)
        else:
            self.current_window = self.current_window.clamped(max_time)
        returned_window = self.timeline.set_data(self.dataset_a, self.dataset_b, selected)
        if reset_window:
            self.current_window = TimeWindow(0.0, max_time)
        self.timeline.set_range(self.current_window)
        self.plot_stack.set_data(
            self.dataset_a,
            self.dataset_b,
            selected,
            self.compare_combo.currentText(),
            self.offset_b,
            self.current_window,
        )
        self.track_panel.set_data(self.dataset_a, self.dataset_b)
        self.set_cursor(min(self.cursor_time, self.current_window.end), force=True)

    def preview_window(self, start: float, end: float) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        self.current_window = TimeWindow(start, end).clamped(max_time)
        self.plot_stack.reset_y_zoom()
        self.plot_stack.set_window(self.current_window, auto_y=True, update_legend=False)

    def set_window(self, start: float, end: float) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        self.current_window = TimeWindow(start, end).clamped(max_time)
        self.plot_stack.reset_y_zoom()
        self.plot_stack.set_window(self.current_window)
        self.update_current_values()

    def _zoom_window(self, start: float, end: float) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        self.current_window = TimeWindow(start, end).clamped(max(1.0, max_time))
        self.plot_stack.set_window(self.current_window)
        self.timeline.set_range(self.current_window)
        self.update_current_values()

    # ── cursor ───────────────────────────────────────────

    def set_cursor(self, t: float, force: bool = False) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        t = max(0.0, min(float(t), max_time))
        if self.dataset_a:
            time_arr = self.dataset_a.frame["Time"].to_numpy(dtype=float, copy=False)
            if len(time_arr) > 0:
                import numpy as np

                idx = int(np.searchsorted(time_arr, t))
                if idx <= 0:
                    t = float(time_arr[0])
                elif idx >= len(time_arr):
                    t = float(time_arr[-1])
                else:
                    t = float(time_arr[idx - 1] if abs(t - time_arr[idx - 1]) <= abs(time_arr[idx] - t) else time_arr[idx])
        self.cursor_time = t
        self.plot_stack.set_cursor(self.cursor_time, force=force)
        self.timeline.set_cursor(self.cursor_time)
        self.time_label.setText(f"当前时间 {self.cursor_time:.3f} s")
        now = time.perf_counter()
        if force or now - self._last_detail_update >= self._detail_update_interval:
            self._last_detail_update = now
            self.update_current_values()

    def update_current_values(self) -> None:
        values: dict[str, str] = {}
        if self.dataset_a and not self.dataset_a.frame.empty:
            time_arr = self.dataset_a.frame["Time"].to_numpy(dtype=float, copy=False)
            idx = 0
            if len(time_arr) > 0:
                import numpy as np

                pos = int(np.searchsorted(time_arr, self.cursor_time))
                if pos <= 0:
                    idx = 0
                elif pos >= len(time_arr):
                    idx = len(time_arr) - 1
                else:
                    before = pos - 1
                    after = pos
                    idx = int(before if abs(self.cursor_time - time_arr[before]) <= abs(time_arr[after] - self.cursor_time) else after)
            for key in self.channel_list.items_by_key:
                if key in self.dataset_a.frame:
                    value = self.dataset_a.frame[key].iat[idx]
                    values[key] = format_value(value)
        self.channel_list.set_current_values(values)
        self.track_panel.update_cursor(
            self.cursor_time,
            self.channel_list.selected_channels(),
            self.offset_b,
            self.current_window,
        )

    # ── offset ───────────────────────────────────────────

    def _offset_slider_changed(self, value: int) -> None:
        if self._syncing_offset:
            return
        self.offset_b = value / 1000.0
        self._set_offset_widgets(self.offset_b)
        self.refresh_all()

    def _offset_spin_changed(self, value: float) -> None:
        if self._syncing_offset:
            return
        self.offset_b = float(value)
        self._set_offset_widgets(self.offset_b)
        self.refresh_all()

    def _set_offset_widgets(self, value: float) -> None:
        self._syncing_offset = True
        self.offset_spin.setValue(value)
        self.offset_slider.setValue(int(round(value * 1000)))
        self._syncing_offset = False

    def auto_align(self) -> None:
        if not self.dataset_a or not self.dataset_b:
            return
        channel = next((ch for ch in self.channel_list.selected_channels() if ch in self.dataset_b.frame), None)
        if not channel:
            QMessageBox.information(self, "自动对齐", "请选择一个在两个文件中都存在的通道。")
            return
        self.auto_align_button.setEnabled(False)
        self.status_label.setText("正在自动对齐...")
        self._align_worker = AutoAlignWorker(self.dataset_a, self.dataset_b, channel, self.current_window)
        self._align_worker.finishedResult.connect(self._on_auto_align_done)
        self._align_worker.finished.connect(self._align_worker.deleteLater)
        self._align_worker.start()

    def _on_auto_align_done(self, offset: float) -> None:
        self.auto_align_button.setEnabled(True)
        limit = self.settings.default_compare_offset_range_seconds
        self.offset_b = max(-limit, min(limit, offset))
        self._set_offset_widgets(self.offset_b)
        self.refresh_all()
        channel = next((ch for ch in self.channel_list.selected_channels() if ch in self.dataset_b.frame), "")
        self.status_label.setText(f"按 {channel} 自动偏移 {self.offset_b:.3f} 秒")

    # ── export ─────────────────────────────────────────

    def export_png(self) -> None:
        if not self.dataset_a:
            return
        filename, _ = QFileDialog.getSaveFileName(self, "导出图表 PNG", "telemetry_chart.png", "PNG (*.png)")
        if filename:
            self.plot_stack.grab_png(Path(filename))
            self.status_label.setText(f"已保存 {Path(filename).name}")

    def export_view_csv(self) -> None:
        if not self.dataset_a:
            return
        selected = self.channel_list.selected_channels()
        if not selected:
            QMessageBox.information(self, "导出 CSV", "请至少选择一个通道。")
            return
        filename, _ = QFileDialog.getSaveFileName(self, "导出处理后的 CSV", "telemetry_view.csv", "CSV (*.csv)")
        if filename:
            from ..processor import export_selected_csv

            export_selected_csv(self.dataset_a, filename, selected, self.current_window, self.dataset_b, self.offset_b)
            self.status_label.setText(f"已保存 {Path(filename).name}")

    def export_full_csv(self) -> None:
        if not self.dataset_a:
            return
        stem = self.dataset_a.meta.file_path.with_suffix(".export.csv").name
        filename, _ = QFileDialog.getSaveFileName(self, "导出完整的 RaceStudio 格式 CSV", stem, "CSV (*.csv)")
        if filename:
            comment_override = None
            if self.settings.export_notes_to_csv and self.record_a_id:
                record = self.library.get_record(self.record_a_id)
                comment_override = record_note_text(record) if record else None
            from ..parser import export_racestudio_like_csv

            export_racestudio_like_csv(self.dataset_a, filename, comment_override=comment_override or None)
            self.status_label.setText(f"已保存 {Path(filename).name}")
