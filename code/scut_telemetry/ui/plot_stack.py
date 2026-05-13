from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import QPoint, Qt, Signal
from PySide6.QtGui import QCursor, QColor, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QToolTip,
    QVBoxLayout,
    QWidget,
)

from ..models import TelemetryDataset, TimeWindow
from ..processor import sample_at
from .formatting import (
    bounded_time_window,
    downsample_true_xy,
    finite_sorted_xy,
    format_value,
    snap_to_sample_time,
    visible_downsampled_xy,
)

CURSOR_PEN = "#FF2D2D"
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

MAIN_PLOT_MIN_POINTS = 2500
MAIN_PLOT_MAX_POINTS = 9000
TRACK_MAX_POINTS = 5000


@dataclass
class PlotEntry:
    plot: pg.PlotItem
    curves: list[tuple[str, str, np.ndarray, np.ndarray, pg.PlotDataItem]]
    color_map: list[tuple[str, QColor]]
    legend_item: pg.TextItem | None = None
    y_user_zoomed: bool = False


class YAxisZoomItem(pg.AxisItem):
    """Left axis that consumes wheel events and zooms only its plot's Y range."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_wheel = None
        self.setAcceptHoverEvents(True)

    def wheelEvent(self, event) -> None:
        if self.on_wheel is None:
            super().wheelEvent(event)
            return
        delta = event.delta() if hasattr(event, "delta") else 0
        if delta == 0:
            super().wheelEvent(event)
            return
        steps = delta / 120.0 if abs(delta) >= 15 else delta / 40.0
        try:
            scene_y = float(event.scenePos().y())
        except Exception:
            scene_y = 0.0
        self.on_wheel(steps, scene_y)
        event.accept()


class TelemetryPlotStack(QWidget):
    cursorChanged = Signal(float)
    zoomChanged = Signal(float, float)

    def __init__(self) -> None:
        super().__init__()
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.channels: list[str] = []
        self.compare_mode = "叠图"
        self.offset_b = 0.0
        self.cursor_time = 0.0
        self.window = TimeWindow(0.0, 1.0)
        self.theme = None
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

    def set_theme(self, theme) -> None:
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

    def _add_plot(self, row: int, channel: str, suffix: str, specs) -> int:
        meta = specs[0][0].channels[channel]
        title = f"{meta.name} [{meta.unit}]"
        if suffix:
            title = f"{title} - {suffix}"
        y_axis = YAxisZoomItem(orientation="left")
        plot = self.graphics.addPlot(row=row, col=0, axisItems={"left": y_axis})
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

        plot.getAxis("left").setWidth(80)
        plot.getAxis("left").enableAutoSIPrefix(False)
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
        plot.getViewBox().sigRangeChanged.connect(lambda: self._reposition_legend(entry))
        y_axis.on_wheel = lambda steps, scene_y, e=entry: self._zoom_entry_y(e, steps, scene_y)
        return row + 1

    def _zoom_entry_y(self, entry: PlotEntry, steps: float, scene_y: float) -> None:
        vb = entry.plot.getViewBox()
        vr = vb.viewRect()
        ymin = float(vr.top())
        ymax = float(vr.bottom())
        if ymax < ymin:
            ymin, ymax = ymax, ymin
        span = ymax - ymin
        if span <= 0:
            return
        vb_rect = vb.sceneBoundingRect()
        if vb_rect.height() > 0:
            rel = (scene_y - vb_rect.top()) / vb_rect.height()
            rel = float(min(1.0, max(0.0, rel)))
            center_y = ymax - rel * span
        else:
            center_y = (ymin + ymax) / 2.0
        factor = 0.85 ** steps
        new_span = max(span * factor, 1e-9)
        ratio = (center_y - ymin) / span
        new_min = center_y - new_span * ratio
        new_max = new_min + new_span
        entry.plot.setYRange(new_min, new_max, padding=0)
        entry.y_user_zoomed = True

    def set_window(self, window: TimeWindow, *, auto_y: bool = True, update_legend: bool = True) -> None:
        self.window = window
        for entry in self.entries:
            self._update_curve_data(entry)
            entry.plot.setXRange(window.start, window.end, padding=0)
            if auto_y and not entry.y_user_zoomed:
                self._auto_y(entry)
        if update_legend:
            self._update_legends()

    def reset_y_zoom(self) -> None:
        for entry in self.entries:
            entry.y_user_zoomed = False
            self._auto_y(entry)
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

    def _build_legend_html(self, meta, color_map, values: dict[str, str] | None = None) -> str:
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
        graphics_pos = self.graphics.mapFrom(self, mouse_pos.toPoint())
        scene_pos = self.graphics.mapToScene(graphics_pos)
        center = self.cursor_time
        for entry in self.entries:
            vb = entry.plot.getViewBox()
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
        for entry in self.entries:
            entry.y_user_zoomed = False
        self.zoomChanged.emit(window.start, window.end)
        event.accept()
        return
