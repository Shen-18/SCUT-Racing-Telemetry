from __future__ import annotations

import time

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QVBoxLayout,
)

from ..models import TelemetryDataset, TimeWindow
from .formatting import (
    bounded_time_window,
    downsample_true_xy,
    finite_sorted_xy,
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
OVERVIEW_MAX_POINTS = 3500


class TimelineWidget(QFrame):
    rangeChanged = Signal(float, float)
    rangeChangeFinished = Signal(float, float)
    cursorChanged = Signal(float)

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.theme = None
        self._updating = False
        self._last_range_emit = 0.0
        self._range_emit_interval = 1 / 30
        self.max_time = 1.0
        self.region = pg.LinearRegionItem([0, 1], bounds=[0, 1], brush=pg.mkColor(94, 106, 210, 40))
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

    def set_theme(self, theme) -> None:
        self.theme = theme
        self.plot.setBackground(theme.plot_background)
        self._style_left_axis()
        self.cursor_line.setPen(pg.mkPen(CURSOR_PEN, width=2))
        self._style_region()

    def _style_left_axis(self) -> None:
        axis = self.plot.getAxis("left")
        axis.setWidth(80)
        axis.setStyle(showValues=False, tickLength=0)
        transparent = pg.mkColor(self.theme.plot_background)
        transparent.setAlpha(0)
        axis.setPen(pg.mkPen(transparent))
        axis.setTextPen(pg.mkPen(transparent))

    def _style_region(self) -> None:
        fill = pg.mkColor(self.theme.accent)
        fill.setAlpha(115 if self.theme.name == "light" else 135)
        edge = pg.mkColor(self.theme.accent)
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
        y_arrays = [self._plot_dataset(dataset_a, channel, pg.mkColor(COLORS[0]), "A")]
        if dataset_b and channel in dataset_b.frame:
            y_arrays.append(self._plot_dataset(dataset_b, channel, pg.mkColor(COLORS[1]), "B"))
        max_time = max(dataset_a.max_time, dataset_b.max_time if dataset_b else 0.0)
        self.max_time = max(1.0, max_time)
        self.plot.setLimits(xMin=0, xMax=self.max_time)
        self.region.setBounds([0, self.max_time])
        current = self.region.getRegion()
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

    def _plot_dataset(self, dataset: TelemetryDataset, channel: str, color, role: str) -> np.ndarray:
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
