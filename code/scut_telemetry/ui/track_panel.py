from __future__ import annotations

from html import escape

import numpy as np
import pyqtgraph as pg
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
)

from ..models import TelemetryDataset, TimeWindow
from .formatting import downsample_true_xy, format_value

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
TRACK_MAX_POINTS = 5000


class TrackPanel(QFrame):
    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self.dataset_a: TelemetryDataset | None = None
        self.dataset_b: TelemetryDataset | None = None
        self.marker_a: pg.ScatterPlotItem | None = None
        self.marker_b: pg.ScatterPlotItem | None = None
        self.theme = None
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

    def set_theme(self, theme) -> None:
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
            from ..processor import sample_at

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
                from ..processor import sample_at

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
            from ..analyzer import summarize_channel

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
        from ..processor import sample_at

        lon = sample_at(dataset, "GPS Longitude", t, offset)
        lat = sample_at(dataset, "GPS Latitude", t, offset)
        if np.isfinite(lon) and np.isfinite(lat):
            marker.setData([lon], [lat])
