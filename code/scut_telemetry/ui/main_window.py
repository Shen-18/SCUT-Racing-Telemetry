from __future__ import annotations

import time
import subprocess
import sys
from dataclasses import dataclass
from html import escape
from pathlib import Path

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import QPoint, QRectF, QThread, Qt, Signal
from PySide6.QtGui import QColor, QCursor, QFont, QIcon, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QMenu,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSlider,
    QSizePolicy,
    QSplitter,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QTextEdit,
    QToolTip,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..analyzer import estimate_offset, summarize_channel
from ..library import (
    DateNote,
    ImportSummary,
    RunRecord,
    TelemetryLibrary,
    expand_import_paths,
    format_chinese_date,
    format_run_time,
    record_note_text,
    safe_filename,
    sha256_file,
)
from ..models import ChannelMeta, TelemetryDataset, TimeWindow
from ..parser import export_racestudio_like_csv, load_telemetry
from ..processor import export_selected_csv, sample_at
from ..settings import (
    DEFAULT_PROFILES,
    AppSettings,
    DisplayProfile,
    current_display_profile,
    default_library_root,
    load_settings,
    save_settings,
    setting_md_path,
)
from .theme import DARK, LIGHT, Theme, apply_theme


COLORS = [
    "#EF4444",
    "#22C55E",
    "#3B82F6",
    "#F59E0B",
    "#A855F7",
    "#14B8A6",
    "#EC4899",
    "#84CC16",
]
SUPPORTED_TELEMETRY_SUFFIXES = {".xrk", ".csv", ".zip"}
CURSOR_PEN = "#FF2D2D"


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


class ChannelRow(QWidget):
    toggled = Signal(str, bool)

    def __init__(self, key: str, meta: ChannelMeta, color: str) -> None:
        super().__init__()
        self.key = key
        self.meta = meta
        self.search_blob = f"{meta.name} {meta.unit}".lower()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(4, 1, 4, 1)
        layout.setSpacing(5)
        self.setFixedHeight(24)

        self.checkbox = QCheckBox()
        self.checkbox.setFixedSize(16, 16)
        self.checkbox.toggled.connect(lambda checked: self.toggled.emit(self.key, checked))
        color_chip = QLabel()
        color_chip.setFixedSize(8, 8)
        color_chip.setStyleSheet(f"background:{color}; border-radius:4px;")
        self.name_label = QLabel(meta.label)
        self.name_label.setObjectName("ChannelName")
        self.name_label.setMinimumWidth(110)
        self.name_label.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        self.value_label = QLabel("")
        self.value_label.setObjectName("ChannelValue")
        self.value_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.value_label.setFixedWidth(68)

        layout.addWidget(self.checkbox)
        layout.addWidget(color_chip)
        layout.addWidget(self.name_label, 1)
        layout.addWidget(self.value_label)

    def is_checked(self) -> bool:
        return self.checkbox.isChecked()

    def set_checked(self, checked: bool, *, block_signal: bool = False) -> None:
        old = self.checkbox.blockSignals(block_signal)
        self.checkbox.setChecked(checked)
        self.checkbox.blockSignals(old)

    def set_value(self, value: str) -> None:
        self.value_label.setText(value)

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self.checkbox.setChecked(not self.checkbox.isChecked())
            event.accept()
            return
        super().mouseReleaseEvent(event)


class ChannelList(QFrame):
    selectionChanged = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.record_a_id: str | None = None
        self.record_b_id: str | None = None
        self.items_by_key: dict[str, QListWidgetItem] = {}
        self.rows_by_key: dict[str, ChannelRow] = {}
        self.value_cache: dict[str, str] = {}
        self._updating = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(8)

        title = QLabel("数据通道")
        title.setObjectName("Title")
        self.file_label = QLabel("未加载文件")
        self.file_label.setObjectName("Muted")
        self.search = QLineEdit()
        self.search.setPlaceholderText("搜索通道或单位")
        self.search.textChanged.connect(self.apply_filter)
        self.list_widget = QListWidget()

        layout.addWidget(title)
        layout.addWidget(self.file_label)
        layout.addWidget(self.search)
        layout.addWidget(self.list_widget, 1)

    def set_datasets(self, dataset_a: TelemetryDataset | None, dataset_b: TelemetryDataset | None) -> None:
        old_selected = set(self.selected_channels())
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self.items_by_key.clear()
        self.rows_by_key.clear()
        self.list_widget.clear()
        if not dataset_a:
            self.file_label.setText("未加载文件")
            return
        if dataset_b:
            self.file_label.setText(f"A: {dataset_a.meta.file_path.name}\nB: {dataset_b.meta.file_path.name}")
            keys = [key for key in dataset_a.header_order if key in dataset_b.channels and key != "Time"]
        else:
            self.file_label.setText(dataset_a.meta.file_path.name)
            keys = [key for key in dataset_a.header_order if key != "Time"]
        for key in keys:
            meta = dataset_a.channels.get(key) or (dataset_b.channels.get(key) if dataset_b else None)
            if not meta or meta.dtype == "text":
                continue
            item = QListWidgetItem()
            item.setData(Qt.UserRole, key)
            item.setFlags(item.flags() | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
            row = ChannelRow(key, meta, COLORS[len(self.items_by_key) % len(COLORS)])
            row.set_checked(key in old_selected, block_signal=True)
            row.set_value(self.value_cache.get(key, ""))
            row.toggled.connect(self._row_toggled)
            item.setSizeHint(row.minimumSizeHint().expandedTo(row.sizeHint()))
            item.setSizeHint(item.sizeHint().expandedTo(pg.QtCore.QSize(0, 24)))
            self.list_widget.addItem(item)
            self.list_widget.setItemWidget(item, row)
            self.items_by_key[key] = item
            self.rows_by_key[key] = row
        if not old_selected:
            self._select_defaults_without_signal()
        self.apply_filter()
        self.selectionChanged.emit()

    def _select_defaults_without_signal(self) -> None:
        """Select default channels without emitting selectionChanged."""
        preferred = ["L MOTOR SPEED", "R MOTOR SPEED", "Battery Current", "GPS Speed"]
        selected = 0
        self._updating = True
        for key in preferred:
            row = self.rows_by_key.get(key)
            if row:
                row.set_checked(True, block_signal=True)
                selected += 1
                if selected >= 3:
                    break
        if selected == 0:
            for idx in range(min(3, self.list_widget.count())):
                item = self.list_widget.item(idx)
                row = self.rows_by_key.get(item.data(Qt.UserRole))
                if row:
                    row.set_checked(True, block_signal=True)
        self._updating = False

    def selected_channels(self) -> list[str]:
        return [key for key, row in self.rows_by_key.items() if row.is_checked()]

    def set_current_values(self, values: dict[str, str]) -> None:
        self.value_cache = values
        for key, row in self.rows_by_key.items():
            row.set_value(values.get(key, ""))

    def apply_filter(self) -> None:
        query = self.search.text().strip().lower()
        for idx in range(self.list_widget.count()):
            item = self.list_widget.item(idx)
            row = self.rows_by_key.get(item.data(Qt.UserRole))
            item.setHidden(bool(query and row and query not in row.search_blob))

    def _row_toggled(self, _key: str, _checked: bool) -> None:
        if not self._updating:
            self.selectionChanged.emit()


@dataclass
class PlotEntry:
    plot: pg.PlotItem
    curves: list[tuple[str, str, np.ndarray, np.ndarray, pg.PlotDataItem]]
    color_map: list[tuple[str, QColor]]
    legend_item: pg.TextItem | None = None


MAIN_PLOT_MIN_POINTS = 2500
MAIN_PLOT_MAX_POINTS = 9000
OVERVIEW_MAX_POINTS = 3500
TRACK_MAX_POINTS = 5000


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
    """Reduce dense lines by keeping real samples in original order."""
    n = len(x)
    if n <= max_points or max_points < 8:
        return x, y
    step = int(np.ceil(n / max_points))
    keep_arr = np.arange(0, n, step, dtype=np.int64)
    if keep_arr[-1] != n - 1:
        keep_arr = np.append(keep_arr, n - 1)
    return x[keep_arr], y[keep_arr]


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


class TelemetryPlotStack(QWidget):
    cursorChanged = Signal(float)

    def __init__(self) -> None:
        super().__init__()
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.channels: list[str] = []
        self.compare_mode = "叠图"
        self.offset_b = 0.0
        self.cursor_time = 0.0
        self.window = TimeWindow(0.0, 1.0)
        self.theme = LIGHT
        self.entries: list[PlotEntry] = []
        self.cursor_lines: list[pg.InfiniteLine] = []
        self._mouse_down = False
        self._last_cursor_emit = 0.0
        self._last_legend_update = 0.0
        self._last_tooltip_update = 0.0
        self._tooltip_interval = 0.25

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.graphics = pg.GraphicsLayoutWidget()
        layout.addWidget(self.graphics)
        self.graphics.scene().sigMouseMoved.connect(self._mouse_moved)
        self.graphics.scene().sigMouseClicked.connect(self._mouse_clicked)

    # Zoom signal emitted when scroll wheel is used on the plot area
    zoomChanged = Signal(float, float)

    def set_theme(self, theme: Theme) -> None:
        self.theme = theme
        self.graphics.setBackground(theme.plot_background)
        self.refresh()

    def set_data(
        self,
        dataset_a: TelemetryDataset | None,
        dataset_b: TelemetryDataset | None,
        channels: list[str],
        compare_mode: str,
        offset_b: float,
        window: TimeWindow,
    ) -> None:
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self.channels = channels
        self.compare_mode = compare_mode
        self.offset_b = offset_b
        self.window = window
        self.refresh()

    def refresh(self) -> None:
        self.graphics.clear()
        self.entries.clear()
        self.cursor_lines.clear()
        if not self.dataset_a or not self.channels:
            label = pg.LabelItem("加载文件并勾选通道以开始绘图。")
            self.graphics.addItem(label)
            return
        row = 0
        for idx, channel in enumerate(self.channels):
            if self.dataset_b and self.compare_mode == "分图" and channel in self.dataset_b.frame:
                row = self._add_plot(row, channel, "A", [(self.dataset_a, "A", 0.0, QColor(COLORS[idx % len(COLORS)]))])
                row = self._add_plot(row, channel, "B", [(self.dataset_b, "B", self.offset_b, QColor(COLORS[(idx + 1) % len(COLORS)]))])
            else:
                specs = [(self.dataset_a, "A", 0.0, QColor(COLORS[idx % len(COLORS)]))]
                if self.dataset_b and channel in self.dataset_b.frame:
                    specs.append((self.dataset_b, "B", self.offset_b, QColor(COLORS[(idx + 1) % len(COLORS)])))
                row = self._add_plot(row, channel, "", specs)
        self.set_window(self.window)
        self.set_cursor(self.cursor_time, force=True)

    def _add_plot(self, row: int, channel: str, suffix: str, specs: list[tuple[TelemetryDataset, str, float, QColor]]) -> int:
        meta = specs[0][0].channels[channel]
        title = f"{meta.name} [{meta.unit}]"
        if suffix:
            title = f"{title} - {suffix}"
        plot = self.graphics.addPlot(row=row, col=0)
        plot.setTitle(title, color=self.theme.text, size="10pt")
        plot.showGrid(x=True, y=True, alpha=0.35)
        plot.setLabel("left", meta.name, units=meta.unit)
        plot.setMenuEnabled(False)
        plot.setMouseEnabled(x=False, y=False)
        plot.setLimits(xMin=0)
        plot.getViewBox().setBackgroundColor(QColor(self.theme.plot_background))
        plot.getAxis("left").setPen(pg.mkPen(self.theme.text_muted))
        plot.getAxis("bottom").setPen(pg.mkPen(self.theme.text_muted))
        plot.getAxis("left").setTextPen(pg.mkPen(self.theme.text_muted))
        plot.getAxis("bottom").setTextPen(pg.mkPen(self.theme.text_muted))
        
        # Ensure left axis has fixed width to align all plots perfectly
        plot.getAxis("left").setWidth(80)
        
        # Disable SI prefix scaling which garbles the axis and causes Trpm
        plot.getAxis("left").enableAutoSIPrefix(False)
        
        # Disable automatic range to let our manual _auto_y and setXRange work
        plot.getViewBox().disableAutoRange()

        curves: list[tuple[str, str, np.ndarray, np.ndarray, pg.PlotDataItem]] = []
        color_map: list[tuple[str, QColor]] = []
        for dataset, role, offset, color in specs:
            x = dataset.frame["Time"].to_numpy(dtype=float) + offset
            y = dataset.frame[channel].to_numpy(dtype=float)
            x, y = finite_sorted_xy(x, y)

            pen = pg.mkPen(color=color, width=2, style=Qt.SolidLine if role == "A" else Qt.DashLine)
            curve = plot.plot([], [], pen=pen, name=role)
            if hasattr(curve, "setClipToView"):
                curve.setClipToView(True)
            curves.append((role, channel, x, y, curve))
            color_map.append((role, color))

        # Add legend-style label in top-right corner (like MATLAB legend)
        legend_html = self._build_legend_html(meta, color_map)
        legend_fill = QColor(self.theme.panel)
        legend_fill.setAlpha(235 if self.theme.name == "light" else 205)
        legend_item = pg.TextItem(
            html=legend_html,
            anchor=(1, 0),
            fill=legend_fill,
            border=pg.mkPen(QColor(self.theme.border)),
        )
        legend_item.setZValue(1000)
        legend_item.setParentItem(plot.getViewBox())
        plot.addItem(legend_item, ignoreBounds=True)

        cursor = pg.InfiniteLine(pos=self.cursor_time, angle=90, movable=False, pen=pg.mkPen(CURSOR_PEN, width=2))
        plot.addItem(cursor, ignoreBounds=True)
        self.cursor_lines.append(cursor)
        entry = PlotEntry(plot=plot, curves=curves, color_map=color_map, legend_item=legend_item)
        self.entries.append(entry)
        # Connect range change to reposition legend
        plot.getViewBox().sigRangeChanged.connect(lambda: self._reposition_legend(entry))
        return row + 1

    def set_window(self, window: TimeWindow, *, auto_y: bool = True, update_legend: bool = True) -> None:
        self.window = window
        for entry in self.entries:
            self._update_curve_data(entry)
            entry.plot.setXRange(window.start, window.end, padding=0)
            if auto_y:
                self._auto_y(entry)
        if update_legend:
            self._update_legends()

    def _plot_point_budget(self, entry: PlotEntry) -> int:
        width = int(entry.plot.getViewBox().sceneBoundingRect().width())
        if width <= 0:
            return MAIN_PLOT_MIN_POINTS
        return max(MAIN_PLOT_MIN_POINTS, min(MAIN_PLOT_MAX_POINTS, width * 4))

    def _update_curve_data(self, entry: PlotEntry) -> None:
        budget = self._plot_point_budget(entry)
        for _, _, x, y, curve in entry.curves:
            dx, dy = visible_downsampled_xy(x, y, self.window, budget)
            curve.setData(dx, dy, stepMode="left", connect="finite")

    def set_cursor(self, t: float, force: bool = False) -> None:
        self.cursor_time = max(0.0, float(t))
        for line in self.cursor_lines:
            line.setValue(self.cursor_time)
        now = time.perf_counter()
        if force or now - self._last_legend_update >= 0.05:
            self._last_legend_update = now
            self._update_legends()

    def _build_legend_html(self, meta: ChannelMeta, color_map: list[tuple[str, QColor]], values: dict[str, str] | None = None) -> str:
        """Build HTML for legend label like MATLAB."""
        parts = []
        for role, color in color_map:
            c = color.name() if isinstance(color, QColor) else str(color)
            val = values.get(role, "") if values else ""
            label = role or meta.name
            if val:
                label += f" {val} {meta.unit}"
            parts.append(f'<span style="color:{c};">&#9632;</span> {label}')
        return (
            f'<div style="color:{self.theme.text}; font-size:10px; line-height:1.15; '
            'padding:1px 4px; white-space:nowrap;">'
            + '<br>'.join(parts)
            + '</div>'
        )

    def _update_legends(self) -> None:
        """Update legend values at current cursor position."""
        for entry in self.entries:
            if not entry.legend_item:
                continue
            values: dict[str, str] = {}
            meta = None
            for role, channel, x, y, _curve in entry.curves:
                if self.dataset_a:
                    meta = self.dataset_a.channels.get(channel)
                if meta is None and self.dataset_b:
                    meta = self.dataset_b.channels.get(channel)
                if meta is None:
                    continue
                # Find value at cursor time
                idx = int(np.searchsorted(x, self.cursor_time))
                if idx <= 0:
                    idx = 0
                elif idx >= len(x):
                    idx = len(x) - 1
                elif abs(self.cursor_time - x[idx - 1]) <= abs(x[idx] - self.cursor_time):
                    idx = idx - 1
                val = float(y[idx]) if len(y) > 0 and np.isfinite(y[idx]) else float('nan')
                values[role] = format_value(val)
            if meta and entry.color_map:
                html = self._build_legend_html(meta, entry.color_map, values)
                entry.legend_item.setHtml(html)
                self._reposition_legend(entry)

    def _reposition_legend(self, entry: PlotEntry) -> None:
        """Position legend at top-right corner using view coordinates."""
        if not entry.legend_item:
            return
        vr = entry.plot.getViewBox().viewRect()
        x_margin = max(vr.width() * 0.004, 1e-9)
        y_margin = max(vr.height() * 0.018, 1e-9)
        entry.legend_item.setPos(vr.right() - x_margin, vr.bottom() - y_margin)

    def _auto_y(self, entry: PlotEntry) -> None:
        all_visible: list[np.ndarray] = []
        for _, _, x, y, _curve in entry.curves:
            left = int(np.searchsorted(x, self.window.start, side="left"))
            right = int(np.searchsorted(x, self.window.end, side="right"))
            visible = y[left:right]
            visible = visible[np.isfinite(visible)]
            if len(visible) > 0:
                all_visible.append(visible)
        if not all_visible:
            return
        combined = np.concatenate(all_visible)
        ymin = float(np.min(combined))
        ymax = float(np.max(combined))
        if abs(ymax - ymin) < 1e-9:
            pad = max(1.0, abs(ymax) * 0.1)
        else:
            pad = (ymax - ymin) * 0.08
        entry.plot.setYRange(ymin - pad, ymax + pad, padding=0)

    def _time_from_scene_pos(self, pos) -> float | None:
        for entry in self.entries:
            vb = entry.plot.getViewBox()
            if vb.sceneBoundingRect().contains(pos):
                mapped = vb.mapSceneToView(pos)
                return max(0.0, float(mapped.x()))
        return None

    def _mouse_clicked(self, event) -> None:
        if event.button() == Qt.LeftButton:
            t = self._time_from_scene_pos(event.scenePos())
            if t is not None:
                self.cursorChanged.emit(snap_to_sample_time(self.dataset_a, t))

    def _mouse_moved(self, pos) -> None:
        t = self._time_from_scene_pos(pos)
        if t is None:
            return
        if QApplication.mouseButtons() & Qt.LeftButton:
            now = time.perf_counter()
            if now - self._last_cursor_emit >= 1 / 60:
                self._last_cursor_emit = now
                self.cursorChanged.emit(snap_to_sample_time(self.dataset_a, t))
        now = time.perf_counter()
        if now - self._last_tooltip_update >= self._tooltip_interval:
            self._last_tooltip_update = now
            self._show_tooltip(snap_to_sample_time(self.dataset_a, t))

    def _show_tooltip(self, t: float) -> None:
        if not self.dataset_a:
            return
        lines = [f"时间: {t:.3f} s"]
        for channel in self.channels[:8]:
            if channel in self.dataset_a.frame:
                meta = self.dataset_a.channels[channel]
                value_a = sample_at(self.dataset_a, channel, t)
                line = f"A {meta.name}: {format_value(value_a)} {meta.unit}"
                if self.dataset_b and channel in self.dataset_b.frame:
                    value_b = sample_at(self.dataset_b, channel, t, self.offset_b)
                    line += f" | B: {format_value(value_b)}"
                lines.append(line)
        QToolTip.showText(QCursor.pos() + QPoint(16, 18), "\n".join(lines), self)

    def grab_png(self, path: Path) -> None:
        pixmap: QPixmap = self.grab()
        pixmap.save(str(path), "PNG")

    def wheelEvent(self, event) -> None:
        """Zoom time axis with mouse wheel centered on mouse position."""
        if not self.dataset_a or not self.entries:
            event.accept()
            return
        delta = event.angleDelta().y()
        if delta == 0 and not event.pixelDelta().isNull():
            delta = event.pixelDelta().y()
        if delta == 0:
            event.accept()
            return
        steps = delta / 120.0 if abs(delta) >= 15 else delta / 40.0
        factor = 0.85 ** steps
        mouse_pos = event.position() if hasattr(event, 'position') else event.posF()
        center = self.cursor_time
        for entry in self.entries:
            vb = entry.plot.getViewBox()
            graphics_pos = self.graphics.mapFrom(self, mouse_pos.toPoint())
            scene_pos = self.graphics.mapToScene(graphics_pos)
            if vb.sceneBoundingRect().contains(scene_pos):
                mapped = vb.mapSceneToView(scene_pos)
                center = max(0.0, float(mapped.x()))
                break
        span = self.window.end - self.window.start
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        new_span = max(0.05, min(span * factor, max_time))
        ratio = (center - self.window.start) / span if span > 0 else 0.5
        new_start = center - new_span * ratio
        new_end = new_start + new_span
        window = bounded_time_window(new_start, new_end, max_time)
        self.zoomChanged.emit(window.start, window.end)
        event.accept()
        return


class TimelineWidget(QFrame):
    rangeChanged = Signal(float, float)
    rangeChangeFinished = Signal(float, float)
    cursorChanged = Signal(float)

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.theme = LIGHT
        self._updating = False
        self._last_range_emit = 0.0
        self._range_emit_interval = 1 / 30
        self.max_time = 1.0
        self.region = pg.LinearRegionItem([0, 1], bounds=[0, 1], brush=QColor(94, 106, 210, 40))
        self.cursor_line = pg.InfiniteLine(pos=0, angle=90, movable=False)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 2, 4, 2)
        layout.setSpacing(2)
        self.label = QLabel("总览")
        self.label.setObjectName("Muted")
        self.plot = pg.PlotWidget()
        self.plot.setFixedHeight(60)
        self.plot.showGrid(x=True, y=False, alpha=0.25)
        self.plot.setMouseEnabled(x=False, y=False)
        self.plot.getAxis("left").setWidth(80)
        self.plot.getAxis("left").setStyle(showValues=False, tickLength=0)
        self.plot.getAxis("left").enableAutoSIPrefix(False)
        self.plot.getViewBox().disableAutoRange()
        self.plot.addItem(self.region, ignoreBounds=True)
        self.plot.addItem(self.cursor_line, ignoreBounds=True)
        self.region.sigRegionChanged.connect(self._region_changed)
        if hasattr(self.region, "sigRegionChangeFinished"):
            self.region.sigRegionChangeFinished.connect(self._region_change_finished)
        self.plot.scene().sigMouseClicked.connect(self._mouse_clicked)
        layout.addWidget(self.label)
        layout.addWidget(self.plot, 1)

    def set_theme(self, theme: Theme) -> None:
        self.theme = theme
        self.plot.setBackground(theme.plot_background)
        self._style_left_axis()
        self.cursor_line.setPen(pg.mkPen(CURSOR_PEN, width=2))
        self._style_region()

    def _style_left_axis(self) -> None:
        axis = self.plot.getAxis("left")
        axis.setWidth(80)
        axis.setStyle(showValues=False, tickLength=0)
        transparent = QColor(self.theme.plot_background)
        transparent.setAlpha(0)
        axis.setPen(pg.mkPen(transparent))
        axis.setTextPen(pg.mkPen(transparent))

    def _style_region(self) -> None:
        fill = QColor(self.theme.accent)
        fill.setAlpha(115 if self.theme.name == "light" else 135)
        edge = QColor(self.theme.accent)
        self.region.setBrush(fill)
        self.region.setOpacity(1.0)
        self.region.setZValue(20)
        for line in getattr(self.region, "lines", []):
            line.setPen(pg.mkPen(edge, width=2))
            if hasattr(line, "setHoverPen"):
                line.setHoverPen(pg.mkPen(edge, width=3))

    def set_data(self, dataset_a: TelemetryDataset | None, dataset_b: TelemetryDataset | None, selected: list[str]) -> TimeWindow:
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self._updating = True
        self.plot.clear()
        self.plot.addItem(self.region, ignoreBounds=True)
        self.plot.addItem(self.cursor_line, ignoreBounds=True)
        if not dataset_a:
            self.max_time = 1.0
            self._updating = False
            return TimeWindow(0, 1)
        channel = self._overview_channel(dataset_a, selected)
        y_arrays = [self._plot_dataset(dataset_a, channel, QColor(COLORS[0]), "A")]
        if dataset_b and channel in dataset_b.frame:
            y_arrays.append(self._plot_dataset(dataset_b, channel, QColor(COLORS[1]), "B"))
        max_time = max(dataset_a.max_time, dataset_b.max_time if dataset_b else 0.0)
        self.max_time = max(1.0, max_time)
        self.plot.setLimits(xMin=0, xMax=self.max_time)
        self.region.setBounds([0, self.max_time])
        current = self.region.getRegion()
        # Reset region to full width if it was the default [0, 1] or invalid
        if current[1] <= current[0] or current[1] > self.max_time or (abs(current[0]) < 1e-6 and abs(current[1] - 1.0) < 1e-6):
            current = [0.0, self.max_time]
        self._set_y_range(y_arrays)
        self.plot.setXRange(0, self.max_time, padding=0.02)
        self.label.setText(f"总览时间轴   0.000 - {self.max_time:.3f} s")
        self._updating = False
        self.set_range(TimeWindow(max(0.0, current[0]), min(self.max_time, current[1])))
        return TimeWindow(float(self.region.getRegion()[0]), float(self.region.getRegion()[1]))

    def set_range(self, window: TimeWindow) -> None:
        self._updating = True
        start = max(0.0, min(float(window.start), self.max_time))
        end = max(start + 0.05, min(float(window.end), self.max_time))
        self.region.setRegion([start, end])
        self.plot.setXRange(0, self.max_time, padding=0.02)
        self._updating = False

    def set_cursor(self, t: float) -> None:
        self.cursor_line.setValue(max(0.0, float(t)))

    def _plot_dataset(self, dataset: TelemetryDataset, channel: str, color: QColor, role: str) -> np.ndarray:
        x = dataset.frame["Time"].to_numpy(dtype=float)
        y = dataset.frame[channel].to_numpy(dtype=float)
        x, y = finite_sorted_xy(x, y)
        plot_x, plot_y = downsample_true_xy(x, y, OVERVIEW_MAX_POINTS)

        curve = self.plot.plot(plot_x, plot_y, pen=pg.mkPen(color=color, width=1.1), name=role)
        return y

    def _set_y_range(self, y_arrays: list[np.ndarray]) -> None:
        finite_arrays = [arr[np.isfinite(arr)] for arr in y_arrays if arr is not None and np.any(np.isfinite(arr))]
        if not finite_arrays:
            return
        values = np.concatenate(finite_arrays)
        ymin = float(np.min(values))
        ymax = float(np.max(values))
        pad = max(1.0, abs(ymax) * 0.1) if abs(ymax - ymin) < 1e-9 else (ymax - ymin) * 0.08
        self.plot.setYRange(ymin - pad, ymax + pad, padding=0)

    def _overview_channel(self, dataset: TelemetryDataset, selected: list[str]) -> str:
        for key in selected:
            if key in dataset.frame:
                return key
        for key in ("GPS Speed", "VehSpd", "L MOTOR SPEED", "Battery Current"):
            if key in dataset.frame:
                return key
        return dataset.numeric_channels()[0].key

    def _region_changed(self) -> None:
        if self._updating:
            return
        start, end = self.region.getRegion()
        start = max(0.0, float(start))
        end = min(self.max_time, max(start + 0.05, float(end)))
        if start < 0 or end > self.max_time:
            self.set_range(TimeWindow(start, end))
            return
        now = time.perf_counter()
        if now - self._last_range_emit < self._range_emit_interval:
            return
        self._last_range_emit = now
        self.rangeChanged.emit(start, end)

    def _region_change_finished(self, *_) -> None:
        if self._updating:
            return
        start, end = self.region.getRegion()
        start = max(0.0, float(start))
        end = min(self.max_time, max(start + 0.05, float(end)))
        self._last_range_emit = time.perf_counter()
        self.rangeChangeFinished.emit(start, end)

    def _mouse_clicked(self, event) -> None:
        if event.button() != Qt.LeftButton:
            return
        vb = self.plot.getViewBox()
        if vb.sceneBoundingRect().contains(event.scenePos()):
            mapped = vb.mapSceneToView(event.scenePos())
            self.cursorChanged.emit(max(0.0, float(mapped.x())))

    def wheelEvent(self, event) -> None:
        """Zoom timeline with mouse wheel."""
        if self.max_time <= 1.0:
            event.accept()
            return
        delta = event.angleDelta().y()
        if delta == 0 and not event.pixelDelta().isNull():
            delta = event.pixelDelta().y()
        if delta == 0:
            event.accept()
            return
        steps = delta / 120.0 if abs(delta) >= 15 else delta / 40.0
        factor = 0.85 ** steps
        start, end = self.region.getRegion()
        span = end - start
        vb = self.plot.getViewBox()
        center = (start + end) / 2
        mouse_pos = event.position() if hasattr(event, 'position') else event.posF()
        plot_pos = self.plot.mapFrom(self, mouse_pos.toPoint())
        scene_pos = self.plot.mapToScene(plot_pos)
        if vb.sceneBoundingRect().contains(scene_pos):
            center = max(0.0, float(vb.mapSceneToView(scene_pos).x()))
        new_span = max(0.05, min(span * factor, self.max_time))
        ratio = (center - start) / span if span > 0 else 0.5
        window = bounded_time_window(center - new_span * ratio, center + new_span * (1 - ratio), self.max_time)
        self._updating = False
        self.set_range(window)
        self.rangeChanged.emit(window.start, window.end)
        self.rangeChangeFinished.emit(window.start, window.end)
        event.accept()
        return


class TrackPanel(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.marker_a: pg.ScatterPlotItem | None = None
        self.marker_b: pg.ScatterPlotItem | None = None
        self.theme = LIGHT
        self._summary_cache: dict[tuple, dict[str, float]] = {}

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        title = QLabel("轨迹 / 统计")
        title.setObjectName("Title")
        self.plot = pg.PlotWidget()
        self.plot.setMinimumHeight(110)
        self.plot.setAspectLocked(True)
        self.plot.hideAxis("bottom")
        self.plot.hideAxis("left")
        self.stats = QTextEdit()
        self.stats.setObjectName("StatsPanel")
        self.stats.setReadOnly(True)
        self.stats.setMinimumHeight(240)
        self.detail_splitter = QSplitter(Qt.Vertical)
        self.detail_splitter.setChildrenCollapsible(False)
        self.detail_splitter.addWidget(self.plot)
        self.detail_splitter.addWidget(self.stats)
        self.detail_splitter.setSizes([170, 430])
        self.detail_splitter.setStretchFactor(0, 0)
        self.detail_splitter.setStretchFactor(1, 1)
        layout.addWidget(title)
        layout.addWidget(self.detail_splitter, 1)

    def set_theme(self, theme: Theme) -> None:
        self.theme = theme
        self.plot.setBackground(theme.plot_background)

    def set_data(self, dataset_a: TelemetryDataset | None, dataset_b: TelemetryDataset | None) -> None:
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self._summary_cache.clear()
        self.plot.clear()
        self.marker_a = None
        self.marker_b = None
        self._plot_track(dataset_a, QColor(COLORS[0]))
        self._plot_track(dataset_b, QColor(COLORS[1]))
        if dataset_a:
            self.marker_a = pg.ScatterPlotItem(size=10, brush=QColor(COLORS[0]), pen=pg.mkPen("#111111"))
            self.plot.addItem(self.marker_a)
        if dataset_b:
            self.marker_b = pg.ScatterPlotItem(size=10, brush=QColor(COLORS[1]), pen=pg.mkPen("#111111"))
            self.plot.addItem(self.marker_b)

    def update_cursor(self, t: float, selected: list[str], offset_b: float, window: TimeWindow | None) -> None:
        self._set_marker(self.dataset_a, self.marker_a, t, 0.0)
        self._set_marker(self.dataset_b, self.marker_b, t, offset_b)
        self.stats.setHtml(self._detail_html(t, selected, offset_b, window))

    def _detail_html(self, t: float, selected: list[str], offset_b: float, window: TimeWindow | None) -> str:
        theme = self.theme
        if not self.dataset_a:
            return f"""
            <div style="color:{theme.text_muted}; font-size:12px; padding:6px;">
                加载文件后，这里会显示当前游标位置的通道详情。
            </div>
            """

        cards: list[str] = []
        for channel in selected[:6]:
            if channel not in self.dataset_a.frame:
                continue
            meta = self.dataset_a.channels[channel]
            stats = self._summary_stats(self.dataset_a, channel, window)
            value = sample_at(self.dataset_a, channel, t)
            unit = f" <span style=\"color:{theme.text_muted};\">[{escape(meta.unit.strip())}]</span>" if meta.unit.strip() else ""
            cards.append(
                f"""
                <div style="border-top:1px solid {theme.border}; padding:7px 0;">
                    <div style="font-weight:700; margin-bottom:4px;">{escape(meta.name)}{unit}</div>
                    <table width="100%" cellspacing="0" cellpadding="2">
                        <tr>
                            <td style="color:{theme.text_muted};">当前值</td>
                            <td align="right"><b style="color:{theme.accent};">{self._value_with_unit(value, meta.unit)}</b></td>
                        </tr>
                        <tr>
                            <td style="color:{theme.text_muted};">选区最小</td>
                            <td align="right">{self._value_with_unit(stats['min'], meta.unit)}</td>
                        </tr>
                        <tr>
                            <td style="color:{theme.text_muted};">选区最大</td>
                            <td align="right">{self._value_with_unit(stats['max'], meta.unit)}</td>
                        </tr>
                        <tr>
                            <td style="color:{theme.text_muted};">选区平均</td>
                            <td align="right">{self._value_with_unit(stats['avg'], meta.unit)}</td>
                        </tr>
                    </table>
                </div>
                """
            )

        if not cards:
            cards.append(
                f'<div style="border-top:1px solid {theme.border}; color:{theme.text_muted}; padding:8px 0;">'
                "勾选左侧通道后显示当前值和选区统计。"
                "</div>"
            )

        window_text = f"{window.start:.3f} - {window.end:.3f} s" if window is not None else "完整区间"
        html = f"""
        <div style="font-family:'Segoe UI','Microsoft YaHei UI',sans-serif; font-size:12px; color:{theme.text};">
            <div style="font-size:13px; font-weight:700; margin-bottom:4px;">
                A 文件：{escape(self.dataset_a.name)}
            </div>
            <div style="color:{theme.text_muted}; margin-bottom:8px;">
                当前时间 <b style="color:{theme.accent};">{t:.3f} s</b>　
                统计区间 {escape(window_text)}
            </div>
            {''.join(cards)}
        """

        if self.dataset_b and selected:
            compare_cards: list[str] = []
            for channel in selected[:4]:
                if channel not in self.dataset_b.frame:
                    continue
                meta = self.dataset_a.channels.get(channel)
                label = meta.name if meta else channel
                unit = meta.unit if meta else ""
                value_a = sample_at(self.dataset_a, channel, t)
                value_b = sample_at(self.dataset_b, channel, t, offset_b)
                diff = value_a - value_b if np.isfinite(value_a) and np.isfinite(value_b) else float("nan")
                compare_cards.append(
                    f"""
                    <div style="border-top:1px solid {theme.border}; padding:7px 0;">
                        <div style="font-weight:700; margin-bottom:4px;">{escape(label)}</div>
                        <table width="100%" cellspacing="0" cellpadding="2">
                            <tr>
                                <td style="color:{theme.text_muted};">A - B 差值</td>
                                <td align="right"><b style="color:{theme.accent};">{self._value_with_unit(diff, unit)}</b></td>
                            </tr>
                        </table>
                    </div>
                    """
                )
            if compare_cards:
                html += f"""
                <div style="height:10px;"></div>
                <div style="font-size:13px; font-weight:700; margin-bottom:4px;">A / B 当前差值</div>
                {''.join(compare_cards)}
                """

        html += "</div>"
        return html

    def _value_with_unit(self, value: float, unit: str) -> str:
        unit = unit.strip()
        text = escape(format_value(value))
        if unit:
            text += f" <span style=\"color:{self.theme.text_muted};\">{escape(unit)}</span>"
        return text

    def _window_key(self, window: TimeWindow | None) -> tuple[float, float] | None:
        if window is None:
            return None
        return (round(float(window.start), 3), round(float(window.end), 3))

    def _summary_stats(self, dataset: TelemetryDataset, channel: str, window: TimeWindow | None) -> dict[str, float]:
        key = (dataset.id, channel, self._window_key(window))
        cached = self._summary_cache.get(key)
        if cached is None:
            cached = summarize_channel(dataset, channel, window)
            self._summary_cache[key] = cached
        return cached

    def _plot_track(self, dataset: TelemetryDataset | None, color: QColor) -> None:
        if not dataset or "GPS Longitude" not in dataset.frame or "GPS Latitude" not in dataset.frame:
            return
        lon = dataset.frame["GPS Longitude"].to_numpy(dtype=float)
        lat = dataset.frame["GPS Latitude"].to_numpy(dtype=float)
        mask = np.isfinite(lon) & np.isfinite(lat)
        if np.count_nonzero(mask) < 2:
            return
        x, y = downsample_true_xy(lon[mask], lat[mask], TRACK_MAX_POINTS)
        curve = self.plot.plot(x, y, pen=pg.mkPen(color=color, width=2))

    def _set_marker(self, dataset: TelemetryDataset | None, marker: pg.ScatterPlotItem | None, t: float, offset: float) -> None:
        if not dataset or not marker or "GPS Longitude" not in dataset.frame or "GPS Latitude" not in dataset.frame:
            return
        lon = sample_at(dataset, "GPS Longitude", t, offset)
        lat = sample_at(dataset, "GPS Latitude", t, offset)
        if np.isfinite(lon) and np.isfinite(lat):
            marker.setData([lon], [lat])


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


class SettingsDialog(QDialog):
    def __init__(self, settings: AppSettings, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("设置")
        self.setMinimumSize(760, 460)
        self.settings = settings

        layout = QVBoxLayout(self)
        tabs = QTabWidget()
        system_tab = QWidget()
        system_layout = QVBoxLayout(system_tab)
        system_layout.setContentsMargins(12, 12, 12, 12)
        self.theme_combo = QComboBox()
        self.theme_combo.addItems(["深色", "浅色"])
        self.theme_combo.setCurrentText("浅色" if settings.default_theme == "light" else "深色")
        system_layout.addWidget(QLabel("默认主题"))
        system_layout.addWidget(self.theme_combo)
        self.display_combo = QComboBox()
        self.display_combo.addItems(["小", "中", "大"])
        preset_label = {"small": "小", "medium": "中", "large": "大"}.get(settings.display_preset, "中")
        self.display_combo.setCurrentText(preset_label)
        system_layout.addWidget(QLabel("界面显示预设"))
        system_layout.addWidget(self.display_combo)
        system_layout.addStretch(1)

        file_tab = QWidget()
        file_layout = QVBoxLayout(file_tab)
        file_layout.setContentsMargins(12, 12, 12, 12)
        file_layout.addWidget(QLabel("资料库位置"))
        path_row = QHBoxLayout()
        self.library_path = QLineEdit(settings.library_root)
        browse = QPushButton("选择...")
        browse.clicked.connect(self._browse_library)
        reset_default = QPushButton("默认位置")
        reset_default.clicked.connect(lambda: self.library_path.setText(str(default_library_root())))
        path_row.addWidget(self.library_path, 1)
        path_row.addWidget(browse)
        path_row.addWidget(reset_default)
        file_layout.addLayout(path_row)
        self.recursive_default = QCheckBox("默认导入文件夹时包含子文件夹")
        self.recursive_default.setChecked(settings.recursive_import)
        file_layout.addWidget(self.recursive_default)
        self.export_notes = QCheckBox("导出完整 CSV 时把资料库备注写入 Comment 行")
        self.export_notes.setChecked(settings.export_notes_to_csv)
        file_layout.addWidget(self.export_notes)
        file_layout.addStretch(1)

        advanced_tab = QWidget()
        advanced_layout = QVBoxLayout(advanced_tab)
        advanced_layout.setContentsMargins(12, 12, 12, 12)
        md_label = QLabel(f"高级配置文件：{setting_md_path()}")
        md_label.setWordWrap(True)
        advanced_layout.addWidget(md_label)
        advanced_layout.addWidget(QLabel("可在 setting.md 中修改字体、行高、默认主题、资料库位置、导入和导出选项。保存后重启软件或重新打开设置并确认即可生效。"))
        open_md = QPushButton("打开 setting.md")
        open_md.clicked.connect(self._open_setting_md)
        advanced_layout.addWidget(open_md)
        advanced_layout.addStretch(1)

        tabs.addTab(system_tab, "系统")
        tabs.addTab(file_tab, "文件")
        tabs.addTab(advanced_tab, "高级")
        layout.addWidget(tabs, 1)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def _browse_library(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "选择资料库位置", self.library_path.text())
        if folder:
            self.library_path.setText(folder)

    def _open_setting_md(self) -> None:
        save_settings(self.result_settings())
        subprocess.Popen(["notepad", str(setting_md_path())])

    def result_settings(self) -> AppSettings:
        preset = {"小": "small", "中": "medium", "大": "large"}.get(self.display_combo.currentText(), "medium")
        profile = self.settings.display_profile if preset == self.settings.display_preset else DEFAULT_PROFILES[preset]
        return AppSettings(
            library_root=self.library_path.text().strip(),
            recursive_import=self.recursive_default.isChecked(),
            default_theme="light" if self.theme_combo.currentText() == "浅色" else "dark",
            display_preset=preset,
            export_notes_to_csv=self.export_notes.isChecked(),
            main_window_width=self.settings.main_window_width,
            main_window_height=self.settings.main_window_height,
            import_folder_dialog_width=self.settings.import_folder_dialog_width,
            import_folder_dialog_height=self.settings.import_folder_dialog_height,
            library_left_width=self.settings.library_left_width,
            library_right_width=self.settings.library_right_width,
            analysis_channel_width=self.settings.analysis_channel_width,
            analysis_plot_width=self.settings.analysis_plot_width,
            analysis_detail_width=self.settings.analysis_detail_width,
            default_compare_offset_range_seconds=self.settings.default_compare_offset_range_seconds,
            display_profile=profile,
        )


class LibraryHome(QWidget):
    openRun = Signal(str)
    compareRun = Signal(str)
    settingsRequested = Signal()

    def __init__(
        self,
        library: TelemetryLibrary,
        display_profile: DisplayProfile | None = None,
        settings: AppSettings | None = None,
    ) -> None:
        super().__init__()
        self.library = library
        self.display_profile = display_profile or DEFAULT_PROFILES["medium"]
        self.settings = settings
        self.records: list[RunRecord] = []
        self.current_category = "all"
        self.category_mode = "date"
        self.worker: LibraryImportWorker | None = None
        self.sort_column = 0
        self.sort_ascending = False

        root = QVBoxLayout(self)
        root.setContentsMargins(4, 4, 4, 4)
        root.setSpacing(4)

        top = QFrame()
        top.setObjectName("TopBar")
        top_layout = QHBoxLayout(top)
        top_layout.setContentsMargins(8, 6, 8, 6)
        top_layout.setSpacing(6)
        title = QLabel("数据资料库")
        title.setObjectName("Title")
        self.import_files_button = QPushButton("导入文件")
        self.import_files_button.clicked.connect(self.import_files)
        self.import_folder_button = QPushButton("导入文件夹")
        self.import_folder_button.clicked.connect(self.import_folder)
        self.recursive_check = QCheckBox("包含子文件夹")
        self.recursive_check.hide()
        self.refresh_button = QPushButton("刷新")
        self.refresh_button.clicked.connect(self.refresh_records)
        self.settings_button = QPushButton("设置")
        self.settings_button.clicked.connect(self.settingsRequested.emit)
        self.home_status = QLabel("就绪")
        self.home_status.setObjectName("Muted")
        self.import_progress = QProgressBar()
        self.import_progress.setFixedWidth(180)
        self.import_progress.setTextVisible(True)
        self.import_progress.hide()
        top_layout.addWidget(title)
        top_layout.addSpacing(12)
        top_layout.addWidget(self.import_files_button)
        top_layout.addWidget(self.import_folder_button)
        top_layout.addWidget(self.refresh_button)
        top_layout.addWidget(self.settings_button)
        top_layout.addStretch(1)
        top_layout.addWidget(self.import_progress)
        top_layout.addWidget(self.home_status)
        root.addWidget(top, 0)

        body = QSplitter(Qt.Horizontal)
        body.setChildrenCollapsible(False)
        left_panel = QFrame()
        left_panel.setObjectName("Panel")
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(10, 10, 10, 10)
        left_layout.setSpacing(8)
        all_title = QLabel("总览")
        all_title.setObjectName("LibrarySection")
        self.category_tree = QTreeWidget()
        self.category_tree.setObjectName("LibraryTree")
        self.category_tree.setColumnCount(3)
        self.category_tree.setHeaderLabels(["分类", "记录", "备注"])
        self.category_tree.setRootIsDecorated(False)
        self.category_tree.setAnimated(True)
        self.category_tree.setAlternatingRowColors(False)
        self.category_tree.itemSelectionChanged.connect(self._category_changed)
        self.category_tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.category_tree.customContextMenuRequested.connect(self._show_category_menu)
        self.category_tree.header().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.category_tree.header().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.category_tree.header().setSectionResizeMode(2, QHeaderView.Stretch)
        left_layout.addWidget(all_title)
        self.all_records_button = QPushButton("全部记录")
        self.all_records_button.setObjectName("FlatNav")
        self.all_records_button.clicked.connect(self._select_all_records)
        left_layout.addWidget(self.all_records_button)
        section_category = QLabel("分类")
        section_category.setObjectName("LibrarySection")
        left_layout.addWidget(section_category)
        mode_row = QHBoxLayout()
        mode_row.setSpacing(6)
        self.category_buttons: dict[str, QPushButton] = {}
        for mode, label in (("date", "按日期"), ("driver", "按车手"), ("vehicle", "按赛车")):
            button = QPushButton(label)
            button.setCheckable(True)
            button.clicked.connect(lambda _checked=False, selected_mode=mode: self._set_category_mode(selected_mode))
            mode_row.addWidget(button)
            self.category_buttons[mode] = button
        left_layout.addLayout(mode_row)
        left_layout.addWidget(self.category_tree, 1)

        right_panel = QFrame()
        right_panel.setObjectName("Panel")
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(10, 10, 10, 10)
        right_layout.setSpacing(8)
        header_row = QHBoxLayout()
        self.table_title = QLabel("全部记录")
        self.table_title.setObjectName("LibraryHeading")
        self.table_count = QLabel("")
        self.table_count.setObjectName("Muted")
        header_row.addWidget(self.table_title)
        header_row.addStretch(1)
        header_row.addWidget(self.table_count)
        self.run_table = QTableWidget()
        self.run_table.setObjectName("LibraryTable")
        self.run_table.setColumnCount(4)
        self._update_time_header()
        self.run_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.run_table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.run_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.run_table.setWordWrap(False)
        self.run_table.verticalHeader().setVisible(False)
        self.run_table.horizontalHeader().setStretchLastSection(False)
        self.run_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Fixed)
        self.run_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Fixed)
        self.run_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Fixed)
        self.run_table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self.run_table.horizontalHeader().setSectionsClickable(True)
        self.run_table.horizontalHeader().sectionClicked.connect(self._header_clicked)
        self.run_table.setColumnWidth(0, 96)
        self.run_table.setColumnWidth(1, 150)
        self.run_table.setColumnWidth(2, 130)
        self.run_table.cellDoubleClicked.connect(self._open_row)
        self.run_table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.run_table.customContextMenuRequested.connect(self._show_context_menu)
        right_layout.addLayout(header_row)
        right_layout.addWidget(self.run_table, 1)
        body.addWidget(left_panel)
        body.addWidget(right_panel)
        body.setSizes(
            [
                self.settings.library_left_width if self.settings else 390,
                self.settings.library_right_width if self.settings else 1120,
            ]
        )
        body.setStretchFactor(0, 0)
        body.setStretchFactor(1, 1)
        root.addWidget(body, 1)
        self.refresh_records()

    def set_display_profile(self, profile: DisplayProfile) -> None:
        self.display_profile = profile
        self._fill_table()

    def set_settings(self, settings: AppSettings) -> None:
        self.settings = settings

    def refresh_records(self) -> None:
        pruned = self.library.prune_missing_records()
        repaired = self.library.repair_filename_metadata()
        self.records = self.library.list_records()
        self._rebuild_categories()
        self._fill_table()
        self.all_records_button.setText(f"全部记录    {len(self.records)}")
        suffix = f"，已清理 {pruned} 条失效记录" if pruned else ""
        if repaired:
            suffix += f"，已修复 {repaired} 条元数据"
        self.home_status.setText(f"共 {len(self.records)} 条记录{suffix}")

    def import_files(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(
            self,
            "导入遥测文件",
            str(Path.cwd().parent / "Data"),
            "遥测文件 (*.xrk *.csv *.zip);;所有文件 (*.*)",
        )
        if files:
            self.import_paths([Path(file) for file in files])

    def import_folder(self) -> None:
        dialog = QDialog(self)
        dialog.setWindowTitle("导入文件夹")
        if self.settings:
            dialog.resize(self.settings.import_folder_dialog_width, self.settings.import_folder_dialog_height)
        else:
            dialog.resize(860, 180)
        layout = QVBoxLayout(dialog)
        row = QHBoxLayout()
        folder_edit = QLineEdit(str(Path.cwd().parent / "Data"))
        browse = QPushButton("选择...")
        def browse_folder() -> None:
            folder = QFileDialog.getExistingDirectory(dialog, "导入文件夹", folder_edit.text())
            if folder:
                folder_edit.setText(folder)
        browse.clicked.connect(browse_folder)
        row.addWidget(folder_edit, 1)
        row.addWidget(browse)
        layout.addLayout(row)
        include_children = QCheckBox("包含子文件夹")
        include_children.setChecked(self.recursive_check.isChecked())
        layout.addWidget(include_children)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        if dialog.exec() == QDialog.Accepted and folder_edit.text().strip():
            self.recursive_check.setChecked(include_children.isChecked())
            self.import_paths([Path(folder_edit.text().strip())], recursive=include_children.isChecked())

    def import_paths(self, paths: list[Path], recursive: bool = False) -> None:
        if not paths:
            return
        self._set_importing(True)
        self.home_status.setText("正在后台导入...")
        self.import_progress.setRange(0, 0)
        self.import_progress.setValue(0)
        self.import_progress.setFormat("准备导入...")
        self.import_progress.show()
        self.worker = LibraryImportWorker(self.library, paths, recursive=recursive)
        self.worker.progressChanged.connect(self._import_progress)
        self.worker.importCompleted.connect(self._import_finished)
        self.worker.finished.connect(self.worker.deleteLater)
        self.worker.start()

    def _set_importing(self, importing: bool) -> None:
        self.import_files_button.setEnabled(not importing)
        self.import_folder_button.setEnabled(not importing)
        self.recursive_check.setEnabled(not importing)
        self.refresh_button.setEnabled(not importing)
        self.settings_button.setEnabled(not importing)

    def _import_progress(self, done: int, total: int, label: str) -> None:
        total = max(1, int(total))
        self.import_progress.setRange(0, total)
        self.import_progress.setValue(min(done, total))
        self.import_progress.setFormat(f"{done}/{total}")
        self.home_status.setText(f"正在导入 {label}")

    def _import_finished(self, summary: ImportSummary) -> None:
        self._set_importing(False)
        self.worker = None
        self.import_progress.hide()
        self.refresh_records()
        text = f"导入 {summary.imported}，跳过 {summary.skipped}，失败 {summary.failed}"
        if summary.errors:
            text += "；" + "；".join(summary.errors[:2])
        self.home_status.setText(text)

    def _rebuild_categories(self) -> None:
        self.category_tree.blockSignals(True)
        self.category_tree.clear()
        for mode, button in self.category_buttons.items():
            button.setChecked(mode == self.category_mode)
        grouped: dict[str, dict[str, int]] = {"date": {}, "driver": {}, "vehicle": {}}
        for record in self.records:
            date_label = format_chinese_date(record.run_datetime)
            driver = record.driver or "未填写车手"
            vehicle = record.vehicle or "未填写车辆"
            grouped["date"][date_label] = grouped["date"].get(date_label, 0) + 1
            grouped["driver"][driver] = grouped["driver"].get(driver, 0) + 1
            grouped["vehicle"][vehicle] = grouped["vehicle"].get(vehicle, 0) + 1
        notes = self.library.date_notes()
        self._update_category_headers()
        labels = sorted(grouped[self.category_mode].items(), reverse=(self.category_mode == "date"))
        for label, count in labels:
            note = notes.get(label) if self.category_mode == "date" else None
            item = QTreeWidgetItem([label, str(count), note.note_title if note else ""])
            item.setData(0, Qt.UserRole, f"{self.category_mode}:{label}")
            self.category_tree.addTopLevelItem(item)
        self.category_tree.setColumnWidth(0, 170)
        self.category_tree.setColumnWidth(1, 58)
        if self.current_category == "all":
            self.category_tree.clearSelection()
        else:
            selected = self._find_category_item(self.current_category)
            if selected:
                self.category_tree.setCurrentItem(selected)
            else:
                self.current_category = "all"
                self.category_tree.clearSelection()
        self.category_tree.blockSignals(False)

    def _set_category_mode(self, mode: str) -> None:
        if mode == self.category_mode:
            return
        self.category_mode = mode
        self.current_category = "all"
        self.sort_column = {"date": 0, "driver": 1, "vehicle": 2}.get(mode, 0)
        self.sort_ascending = mode != "date"
        self._update_headers()
        self._rebuild_categories()
        self._fill_table()

    def _update_category_headers(self) -> None:
        first = {"date": "日期", "driver": "车手", "vehicle": "赛车"}.get(self.category_mode, "分类")
        self.category_tree.setHeaderLabels([first, "记录", "备注"])

    def _find_category_item(self, category: str) -> QTreeWidgetItem | None:
        target = category if ":" in category else f"date:{category}"
        for idx in range(self.category_tree.topLevelItemCount()):
            parent = self.category_tree.topLevelItem(idx)
            if parent.data(0, Qt.UserRole) == target:
                return parent
            for child_idx in range(parent.childCount()):
                item = parent.child(child_idx)
                if item.data(0, Qt.UserRole) == target:
                    return item
        return None

    def _category_changed(self) -> None:
        item = self.category_tree.currentItem()
        value = item.data(0, Qt.UserRole) if item else "all"
        self.current_category = value if item else "all"
        self._fill_table()

    def _select_all_records(self) -> None:
        self.category_tree.clearSelection()
        self.current_category = "all"
        self._fill_table()

    def _date_label_at_pos(self, pos) -> str | None:
        item = self.category_tree.itemAt(pos)
        value = item.data(0, Qt.UserRole) if item else None
        if isinstance(value, str) and value.startswith("date:"):
            return value.split(":", 1)[1]
        return None

    def _show_category_menu(self, pos) -> None:
        date_label = self._date_label_at_pos(pos)
        if not date_label:
            return
        item = self.category_tree.itemAt(pos)
        if item:
            self.category_tree.setCurrentItem(item)
        menu = QMenu(self)
        edit_note = menu.addAction("备注")
        export_zip = menu.addAction("导出当天 CSV 压缩包")
        delete_day = menu.addAction("删除当天全部记录")
        action = menu.exec(self.category_tree.viewport().mapToGlobal(pos))
        if action is edit_note:
            self.edit_date_note(date_label)
        elif action is export_zip:
            self.export_date_zip(date_label)
        elif action is delete_day:
            self.delete_date_records(date_label)

    def edit_date_note(self, date_label: str) -> None:
        note = self.library.get_date_note(date_label)
        values = self._edit_note_values("日期备注", note.note_title, note.note_body)
        if values is None:
            return
        title, body = values
        self.library.update_date_note(date_label, title, body)
        self.refresh_records()

    def export_date_zip(self, date_label: str) -> None:
        records = [record for record in self.records if format_chinese_date(record.run_datetime) == date_label]
        self.export_records(records, default_name=safe_filename(f"{date_label}_{self.library.get_date_note(date_label).note_title}".strip("_")) + ".zip")

    def delete_date_records(self, date_label: str) -> None:
        records = [record for record in self.records if format_chinese_date(record.run_datetime) == date_label]
        if not records:
            return
        result = QMessageBox.question(self, "删除当天记录", f"从数据库删除 {date_label} 的 {len(records)} 条记录？")
        if result == QMessageBox.Yes:
            self.library.delete_records([record.id for record in records])
            self.refresh_records()

    def export_records(self, records: list[RunRecord], default_name: str = "telemetry_export.zip") -> None:
        if not records:
            return
        if len(records) == 1:
            default_name = safe_filename(Path(records[0].original_name).stem) + ".zip"
        filename, _ = QFileDialog.getSaveFileName(self, "导出 CSV 压缩包", default_name, "ZIP (*.zip)")
        if not filename:
            return
        try:
            count = self.library.export_records_zip(records, Path(filename), include_notes=True)
        except Exception as exc:
            QMessageBox.critical(self, "导出失败", str(exc))
            return
        self.home_status.setText(f"已导出 {count} 个 CSV 到 {Path(filename).name}")

    def _filtered_records(self) -> list[RunRecord]:
        if self.current_category == "all":
            records = self.records
        elif str(self.current_category).startswith("date:"):
            label = str(self.current_category).split(":", 1)[1]
            records = [record for record in self.records if format_chinese_date(record.run_datetime) == label]
        elif str(self.current_category).startswith("driver:"):
            label = str(self.current_category).split(":", 1)[1]
            records = [record for record in self.records if (record.driver or "未填写车手") == label]
        elif str(self.current_category).startswith("vehicle:"):
            label = str(self.current_category).split(":", 1)[1]
            records = [record for record in self.records if (record.vehicle or "未填写车辆") == label]
        else:
            records = [record for record in self.records if format_chinese_date(record.run_datetime) == self.current_category]
        return sorted(records, key=self._sort_value, reverse=not self.sort_ascending)

    def _category_kind(self) -> str:
        return str(self.current_category).split(":", 1)[0] if ":" in str(self.current_category) else self.category_mode

    def _expand_current_group(self) -> None:
        return

    def _sort_value(self, record: RunRecord):
        if self.sort_column == 1:
            return (record.driver or "").lower()
        if self.sort_column == 2:
            return (record.vehicle or "").lower()
        return record.run_datetime

    def _header_clicked(self, section: int) -> None:
        if section not in (0, 1, 2):
            return
        if self.sort_column == section:
            self.sort_ascending = not self.sort_ascending
        else:
            self.sort_column = section
            self.sort_ascending = True
        self._update_headers()
        self._fill_table()

    def _update_time_header(self) -> None:
        self._update_headers()

    def _update_headers(self) -> None:
        labels = ["跑动时间", "赛车手", "车辆", "备注"]
        labels[self.sort_column] += " " + ("↑" if self.sort_ascending else "↓")
        self.run_table.setHorizontalHeaderLabels(labels)

    def _fill_table(self) -> None:
        records = self._filtered_records()
        self.table_title.setText(self._category_label())
        self.table_count.setText(f"{len(records)} 条记录")
        rows: list[RunRecord | str] = []
        last_group = ""
        for record in records:
            current_group = self._record_group_label(record)
            if self.current_category == "all" and current_group != last_group:
                rows.append(current_group)
                last_group = current_group
            rows.append(record)
        self.run_table.clearSpans()
        self.run_table.clearContents()
        self.run_table.setRowCount(len(rows))
        for row, entry in enumerate(rows):
            if isinstance(entry, str):
                item = QTableWidgetItem(entry)
                item.setData(Qt.UserRole, "")
                item.setFlags(Qt.ItemIsEnabled)
                font = QFont()
                font.setBold(True)
                item.setFont(font)
                self.run_table.setItem(row, 0, item)
                self.run_table.setSpan(row, 0, 1, self.run_table.columnCount())
                self.run_table.setRowHeight(row, self.display_profile.library_group_row_height)
                continue
            record = entry
            time_text = format_run_time(record.run_datetime)
            items = [
                QTableWidgetItem(time_text),
                QTableWidgetItem(record.driver or "未填写"),
                QTableWidgetItem(record.vehicle or "未填写"),
                QTableWidgetItem(record.note_title),
            ]
            items[0].setData(Qt.UserRole, record.id)
            for col, item in enumerate(items):
                self.run_table.setItem(row, col, item)
            self.run_table.setRowHeight(row, self.display_profile.library_row_height)

    def _category_label(self) -> str:
        mode_label = {"date": "按日期", "driver": "按车手", "vehicle": "按赛车"}.get(self._category_kind(), "分类")
        if self.current_category == "all":
            return f"全部记录（{mode_label}浏览）"
        text = str(self.current_category)
        value = text.split(":", 1)[1] if ":" in text else text
        return f"{mode_label}：{value}"

    def _record_group_label(self, record: RunRecord) -> str:
        if self.category_mode == "driver":
            return record.driver or "未填写车手"
        if self.category_mode == "vehicle":
            return record.vehicle or "未填写车辆"
        return format_chinese_date(record.run_datetime)

    def _open_row(self, row: int, _column: int) -> None:
        item = self.run_table.item(row, 0)
        if item and item.data(Qt.UserRole):
            self.openRun.emit(str(item.data(Qt.UserRole)))

    def record_id_at_row(self, row: int) -> str | None:
        item = self.run_table.item(row, 0)
        value = item.data(Qt.UserRole) if item else None
        return str(value) if value else None

    def selected_record_ids(self) -> list[str]:
        ids: list[str] = []
        for index in self.run_table.selectionModel().selectedRows():
            record_id = self.record_id_at_row(index.row())
            if record_id and record_id not in ids:
                ids.append(record_id)
        return ids

    def records_by_ids(self, record_ids: list[str]) -> list[RunRecord]:
        by_id = {record.id: record for record in self.records}
        return [by_id[record_id] for record_id in record_ids if record_id in by_id]

    def _show_context_menu(self, pos) -> None:
        row = self.run_table.rowAt(pos.y())
        if row < 0:
            return
        record_id = self.record_id_at_row(row)
        if not record_id:
            return
        if record_id not in self.selected_record_ids():
            self.run_table.selectRow(row)
        selected_ids = self.selected_record_ids() or [record_id]
        selected_records = self.records_by_ids(selected_ids)
        menu = QMenu(self)
        single = len(selected_ids) == 1
        analyze = menu.addAction("分析") if single else None
        compare = menu.addAction("对比") if single else None
        note = menu.addAction("备注") if single else None
        props = menu.addAction("属性") if single else None
        export_zip = menu.addAction("导出 CSV 压缩包" if single else f"导出选中 {len(selected_ids)} 条")
        delete = menu.addAction("删除" if single else f"删除选中 {len(selected_ids)} 条")
        open_folder = menu.addAction("在文件夹打开") if single else None
        action = menu.exec(self.run_table.viewport().mapToGlobal(pos))
        if action is analyze:
            self.openRun.emit(record_id)
        elif action is compare:
            self.compareRun.emit(record_id)
        elif action is note:
            self.edit_note(record_id)
        elif action is props:
            self.show_properties(record_id)
        elif action is export_zip:
            self.export_records(selected_records)
        elif action is delete:
            self.delete_records(selected_ids)
        elif action is open_folder:
            self.open_in_folder(record_id)

    def edit_note(self, record_id: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        values = self._edit_note_values("备注", record.note_title, record.note_body)
        if values is None:
            return
        title, body = values
        self.library.update_note(record_id, title, body)
        self.refresh_records()

    def _edit_note_values(self, title: str, current_title: str, current_body: str) -> tuple[str, str] | None:
        dialog = QDialog(self)
        dialog.setWindowTitle(title)
        layout = QVBoxLayout(dialog)
        layout.addWidget(QLabel("标题"))
        title_edit = QLineEdit(current_title)
        layout.addWidget(title_edit)
        layout.addWidget(QLabel("内容"))
        body_edit = QTextEdit()
        body_edit.setPlainText(current_body)
        body_edit.setMinimumHeight(180)
        layout.addWidget(body_edit)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        if dialog.exec() != QDialog.Accepted:
            return None
        return title_edit.text(), body_edit.toPlainText()

    def show_properties(self, record_id: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        detail = (
            f"文件名：{record.original_name}\n"
            f"日期：{format_chinese_date(record.run_datetime)}\n"
            f"时间：{format_run_time(record.run_datetime)}\n"
            f"车手：{record.driver or '未填写'}\n"
            f"车辆：{record.vehicle or '未填写'}\n"
            f"时长：{record.duration:.3f} s\n"
            f"备注标题：{record.note_title}\n"
            f"备注内容：{record.note_body}\n\n"
            f"原始路径：{record.original_path}\n"
            f"资料库路径：{record.stored_path}"
        )
        QMessageBox.information(self, "属性", detail)

    def delete_record(self, record_id: str) -> None:
        self.delete_records([record_id])

    def delete_records(self, record_ids: list[str]) -> None:
        records = self.records_by_ids(record_ids)
        if not records:
            return
        label = records[0].original_name if len(records) == 1 else f"{len(records)} 条记录"
        result = QMessageBox.question(self, "删除记录", f"从数据库删除 {label}？")
        if result == QMessageBox.Yes:
            self.library.delete_records([record.id for record in records])
            self.refresh_records()

    def open_in_folder(self, record_id: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        original = Path(record.original_path)
        if original.exists():
            subprocess.Popen(["explorer", "/select,", str(original)])
            return
        QMessageBox.warning(
            self,
            "原始文件不存在",
            f"原始文件已被删除或移动：\n{record.original_path}\n\n资料库文件位置：\n{record.stored_path}",
        )


class LibraryRunDialog(QDialog):
    def __init__(self, records: list[RunRecord], display_profile: DisplayProfile | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle("从资料库选择 B 文件")
        self.setMinimumSize(1200, 760)
        self.records = records
        self.display_profile = display_profile or DEFAULT_PROFILES["medium"]
        self.current_category = "all"
        self.sort_column = 0
        self.sort_ascending = False
        self.selected_record_id: str | None = None
        self.external_requested = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        top = QHBoxLayout()
        title = QLabel("选择 B 文件")
        title.setObjectName("LibraryHeading")
        self.count_label = QLabel("")
        self.count_label.setObjectName("Muted")
        top.addWidget(title)
        top.addStretch(1)
        top.addWidget(self.count_label)
        layout.addLayout(top)

        body = QSplitter(Qt.Horizontal)
        left_panel = QFrame()
        left_panel.setObjectName("Panel")
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(10, 10, 10, 10)
        left_layout.setSpacing(8)
        section_all = QLabel("总览")
        section_all.setObjectName("LibrarySection")
        self.all_button = QPushButton("全部记录")
        self.all_button.setObjectName("FlatNav")
        self.all_button.clicked.connect(self._select_all)
        section_date = QLabel("按日期")
        section_date.setObjectName("LibrarySection")
        self.category_tree = QTreeWidget()
        self.category_tree.setObjectName("LibraryTree")
        self.category_tree.setColumnCount(2)
        self.category_tree.setHeaderLabels(["日期", "记录"])
        self.category_tree.setRootIsDecorated(False)
        self.category_tree.header().setSectionResizeMode(0, QHeaderView.Stretch)
        self.category_tree.header().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.category_tree.itemSelectionChanged.connect(self._category_changed)
        left_layout.addWidget(section_all)
        left_layout.addWidget(self.all_button)
        left_layout.addWidget(section_date)
        left_layout.addWidget(self.category_tree, 1)

        right_panel = QFrame()
        right_panel.setObjectName("Panel")
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(10, 10, 10, 10)
        right_layout.setSpacing(8)
        header = QHBoxLayout()
        self.table_title = QLabel("全部记录")
        self.table_title.setObjectName("LibraryHeading")
        header.addWidget(self.table_title)
        header.addStretch(1)
        self.table = QTableWidget()
        self.table.setObjectName("LibraryTable")
        self.table.setColumnCount(4)
        self._update_time_header()
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setWordWrap(False)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Fixed)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Fixed)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Fixed)
        self.table.horizontalHeader().setSectionResizeMode(3, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionsClickable(True)
        self.table.horizontalHeader().sectionClicked.connect(self._header_clicked)
        self.table.setColumnWidth(0, 96)
        self.table.setColumnWidth(1, 150)
        self.table.setColumnWidth(2, 130)
        self.table.cellDoubleClicked.connect(lambda *_: self.accept())
        right_layout.addLayout(header)
        right_layout.addWidget(self.table, 1)
        body.addWidget(left_panel)
        body.addWidget(right_panel)
        body.setSizes([420, 900])
        layout.addWidget(body, 1)

        buttons = QDialogButtonBox(QDialogButtonBox.Open | QDialogButtonBox.Cancel)
        self.external_button = buttons.addButton("选择外部文件", QDialogButtonBox.ActionRole)
        self.external_button.clicked.connect(self._choose_external)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)
        self._rebuild_categories()
        self._fill_table()

    def _rebuild_categories(self) -> None:
        self.category_tree.blockSignals(True)
        self.category_tree.clear()
        grouped: dict[str, int] = {}
        for record in self.records:
            grouped[format_chinese_date(record.run_datetime)] = grouped.get(format_chinese_date(record.run_datetime), 0) + 1
        for label, count in grouped.items():
            item = QTreeWidgetItem([label, str(count)])
            item.setData(0, Qt.UserRole, label)
            self.category_tree.addTopLevelItem(item)
        self.all_button.setText(f"全部记录    {len(self.records)}")
        self.category_tree.setColumnWidth(0, 300)
        self.category_tree.blockSignals(False)

    def _filtered_records(self) -> list[RunRecord]:
        if self.current_category == "all":
            records = self.records
        else:
            records = [record for record in self.records if format_chinese_date(record.run_datetime) == self.current_category]
        return sorted(records, key=self._sort_value, reverse=not self.sort_ascending)

    def _sort_value(self, record: RunRecord):
        if self.sort_column == 1:
            return (record.driver or "").lower()
        if self.sort_column == 2:
            return (record.vehicle or "").lower()
        return record.run_datetime

    def _header_clicked(self, section: int) -> None:
        if section not in (0, 1, 2):
            return
        if self.sort_column == section:
            self.sort_ascending = not self.sort_ascending
        else:
            self.sort_column = section
            self.sort_ascending = True
        self._update_time_header()
        self._fill_table()

    def _update_time_header(self) -> None:
        labels = ["跑动时间", "赛车手", "车辆", "备注"]
        labels[self.sort_column] += " " + ("↑" if self.sort_ascending else "↓")
        self.table.setHorizontalHeaderLabels(labels)

    def _fill_table(self) -> None:
        records = self._filtered_records()
        self.table_title.setText("全部记录" if self.current_category == "all" else self.current_category)
        self.count_label.setText(f"{len(records)} 条记录")
        rows: list[RunRecord | str] = []
        last_date = ""
        for record in records:
            current_date = format_chinese_date(record.run_datetime)
            if self.current_category == "all" and current_date != last_date:
                rows.append(current_date)
                last_date = current_date
            rows.append(record)
        self.table.clearSpans()
        self.table.clearContents()
        self.table.setRowCount(len(rows))
        for row, entry in enumerate(rows):
            if isinstance(entry, str):
                item = QTableWidgetItem(entry)
                item.setData(Qt.UserRole, "")
                item.setFlags(Qt.ItemIsEnabled)
                font = QFont()
                font.setBold(True)
                item.setFont(font)
                self.table.setItem(row, 0, item)
                self.table.setSpan(row, 0, 1, self.table.columnCount())
                self.table.setRowHeight(row, self.display_profile.library_group_row_height)
                continue
            record = entry
            time_text = format_run_time(record.run_datetime)
            items = [
                QTableWidgetItem(time_text),
                QTableWidgetItem(record.driver or "未填写"),
                QTableWidgetItem(record.vehicle or "未填写"),
                QTableWidgetItem(record.note_title),
            ]
            items[0].setData(Qt.UserRole, record.id)
            for col, item in enumerate(items):
                self.table.setItem(row, col, item)
            self.table.setRowHeight(row, self.display_profile.library_row_height)
        for row in range(self.table.rowCount()):
            if self.table.item(row, 0) and self.table.item(row, 0).data(Qt.UserRole):
                self.table.selectRow(row)
                break

    def _select_all(self) -> None:
        self.current_category = "all"
        self.category_tree.clearSelection()
        self._fill_table()

    def _category_changed(self) -> None:
        item = self.category_tree.currentItem()
        self.current_category = item.data(0, Qt.UserRole) if item else "all"
        self._fill_table()

    def accept(self) -> None:
        if not self.external_requested:
            row = self.table.currentRow()
            if row < 0:
                return
            item = self.table.item(row, 0)
            self.selected_record_id = str(item.data(Qt.UserRole)) if item else None
            if not self.selected_record_id:
                return
        super().accept()

    def _choose_external(self) -> None:
        self.external_requested = True
        super().accept()


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
        self._apply_theme()

        if new_root != old_root:
            self.library = TelemetryLibrary(new_root)
            self.home_page.library = self.library
            self.home_page.set_settings(self.settings)
            self.home_page.refresh_records()
            self.status_label.setText(f"资料库已切换到 {new_root}")

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

    def load_record(self, role: str, record: RunRecord) -> None:
        path = Path(record.stored_path)
        self.status_label.setText(f"正在加载 {record.original_name}...")
        QApplication.processEvents()
        try:
            dataset = load_telemetry(path)
        except Exception as exc:
            QMessageBox.critical(self, "加载失败", f"{record.original_name}\n\n{exc}")
            self.status_label.setText("加载失败")
            return
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
        QApplication.processEvents()
        try:
            dataset = load_telemetry(path)
        except Exception as exc:
            QMessageBox.critical(self, "加载失败", f"{path.name}\n\n{exc}")
            self.status_label.setText("加载失败")
            return
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
        # Disconnect selectionChanged during set_datasets to prevent premature
        # refresh_all(reset_window=False) which would set current_window to [0,1]
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
            # Force timeline to full range, ignoring any stale region state
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
        self.plot_stack.set_window(self.current_window, auto_y=False, update_legend=False)

    def set_window(self, start: float, end: float) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        self.current_window = TimeWindow(start, end).clamped(max_time)
        self.plot_stack.set_window(self.current_window)
        self.update_current_values()

    def _zoom_window(self, start: float, end: float) -> None:
        """Handle scroll wheel zoom from plot area."""
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        self.current_window = TimeWindow(start, end).clamped(max(1.0, max_time))
        self.plot_stack.set_window(self.current_window)
        self.timeline.set_range(self.current_window)
        self.update_current_values()

    def set_cursor(self, t: float, force: bool = False) -> None:
        max_time = max(
            self.dataset_a.max_time if self.dataset_a else 1.0,
            self.dataset_b.max_time + self.offset_b if self.dataset_b else 1.0,
        )
        # Snap to nearest actual data sample time (e.g. 20Hz = every 0.05s)
        t = max(0.0, min(float(t), max_time))
        if self.dataset_a:
            time_arr = self.dataset_a.frame["Time"].to_numpy(dtype=float, copy=False)
            if len(time_arr) > 0:
                idx = int(np.searchsorted(time_arr, t))
                if idx <= 0:
                    t = float(time_arr[0])
                elif idx >= len(time_arr):
                    t = float(time_arr[-1])
                else:
                    # Pick whichever sample is closer
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
        offset = estimate_offset(self.dataset_a, self.dataset_b, channel, self.current_window)
        limit = self.settings.default_compare_offset_range_seconds
        self.offset_b = max(-limit, min(limit, offset))
        self._set_offset_widgets(self.offset_b)
        self.refresh_all()
        self.status_label.setText(f"按 {channel} 自动偏移 {self.offset_b:.3f} 秒")

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
            export_racestudio_like_csv(self.dataset_a, filename, comment_override=comment_override or None)
            self.status_label.setText(f"已保存 {Path(filename).name}")

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
