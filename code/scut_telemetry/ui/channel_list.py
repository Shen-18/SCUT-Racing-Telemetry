from __future__ import annotations

from html import escape

import pyqtgraph as pg
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QSizePolicy,
    QVBoxLayout,
    QWidget,
)

from ..models import ChannelMeta, TelemetryDataset


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

METADATA_FIELD_LABELS: list[tuple[str, str]] = [
    ("file_path", "文件路径"),
    ("session", "Session"),
    ("vehicle", "车辆"),
    ("racer", "车手"),
    ("championship", "赛事"),
    ("date", "日期"),
    ("start_time", "开始时间"),
    ("duration", "时长"),
    ("sample_rate_hz", "采样率"),
    ("laps", "圈数"),
    ("comment", "备注"),
]


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
        self.channel_order: list[str] = []
        self._updating = False
        self._metadata_fields: list[str] = [k for k, _ in METADATA_FIELD_LABELS]
        self._metadata_expanded: bool = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(8)

        title = QLabel("数据通道")
        title.setObjectName("Title")
        self.file_label = QLabel("未加载文件")
        self.file_label.setObjectName("Muted")
        self.file_label.setWordWrap(True)

        # Collapsible metadata panel
        self.meta_toggle = QPushButton("▸ 文件信息")
        self.meta_toggle.setCheckable(True)
        self.meta_toggle.setObjectName("MetaToggle")
        self.meta_toggle.setStyleSheet(
            "QPushButton#MetaToggle{text-align:left;padding:4px 6px;border:none;background:transparent;}"
            "QPushButton#MetaToggle:hover{background:rgba(127,127,127,0.12);border-radius:4px;}"
        )
        self.meta_toggle.toggled.connect(self._on_meta_toggled)
        self.meta_panel = QFrame()
        self.meta_panel.setObjectName("MetaPanel")
        meta_layout = QVBoxLayout(self.meta_panel)
        meta_layout.setContentsMargins(8, 4, 8, 6)
        meta_layout.setSpacing(2)
        self.meta_text = QLabel("")
        self.meta_text.setWordWrap(True)
        self.meta_text.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.meta_text.setObjectName("Muted")
        meta_layout.addWidget(self.meta_text)
        self.meta_panel.setVisible(False)

        self.search = QLineEdit()
        self.search.setPlaceholderText("搜索未选通道或单位")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self.apply_filter)
        self.selected_list_widget = QListWidget()
        self.selected_list_widget.setMinimumHeight(0)
        self.selected_list_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Maximum)
        self.available_list_widget = QListWidget()
        self.available_list_widget.setMinimumHeight(0)
        self.available_list_widget.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        # Backwards-compatible alias for code/tests that refer to the available channel list.
        self.list_widget = self.available_list_widget

        self.channel_section = QWidget()
        channel_layout = QVBoxLayout(self.channel_section)
        channel_layout.setContentsMargins(0, 0, 0, 0)
        channel_layout.setSpacing(6)
        self.channel_separator = QFrame()
        self.channel_separator.setObjectName("ChannelSeparator")
        self.channel_separator.setFrameShape(QFrame.HLine)
        self.channel_separator.setFrameShadow(QFrame.Plain)
        self.channel_separator.setFixedHeight(8)
        self.channel_separator.setStyleSheet(
            "QFrame#ChannelSeparator {"
            "border: none;"
            "border-top: 2px solid rgba(148, 163, 184, 0.72);"
            "background: transparent;"
            "margin: 3px 0;"
            "}"
        )
        channel_layout.addWidget(self.selected_list_widget, 0)
        channel_layout.addWidget(self.channel_separator)
        channel_layout.addWidget(self.available_list_widget, 1)

        layout.addWidget(title)
        layout.addWidget(self.file_label)
        layout.addWidget(self.meta_toggle)
        layout.addWidget(self.meta_panel)
        layout.addWidget(self.search)
        layout.addWidget(self.channel_section, 1)

    def apply_metadata_settings(self, expanded: bool, fields_csv: str) -> None:
        self._metadata_fields = [f.strip() for f in (fields_csv or "").split(",") if f.strip()]
        self._metadata_expanded = bool(expanded)
        self.meta_toggle.blockSignals(True)
        self.meta_toggle.setChecked(self._metadata_expanded)
        self.meta_toggle.blockSignals(False)
        self._update_meta_toggle_label()
        self.meta_panel.setVisible(self._metadata_expanded)
        self._refresh_meta_text()

    def _on_meta_toggled(self, checked: bool) -> None:
        self._metadata_expanded = bool(checked)
        self.meta_panel.setVisible(self._metadata_expanded)
        self._update_meta_toggle_label()

    def _update_meta_toggle_label(self) -> None:
        arrow = "▾" if self._metadata_expanded else "▸"
        self.meta_toggle.setText(f"{arrow} 文件信息")

    def _format_meta_value(self, dataset: TelemetryDataset, key: str) -> str | None:
        meta = dataset.meta
        if key == "file_path":
            return str(meta.file_path)
        if key == "session":
            return meta.session or None
        if key == "vehicle":
            return meta.vehicle or None
        if key == "racer":
            return meta.racer or None
        if key == "championship":
            return meta.championship or None
        if key == "date":
            return meta.date or None
        if key == "start_time":
            return meta.start_time or None
        if key == "duration":
            if meta.duration:
                return f"{meta.duration:.2f} s"
            return None
        if key == "sample_rate_hz":
            if meta.sample_rate_hz:
                return f"{meta.sample_rate_hz:g} Hz"
            return None
        if key == "laps":
            return str(len(meta.laps)) if meta.laps else None
        if key == "comment":
            return meta.comment or None
        return None

    def _build_meta_html(self, dataset: TelemetryDataset, role: str) -> str:
        label_map = dict(METADATA_FIELD_LABELS)
        rows: list[str] = []
        for key in self._metadata_fields:
            label = label_map.get(key, key)
            val = self._format_meta_value(dataset, key)
            if not val:
                continue
            rows.append(
                f'<tr><td style="color:#888;padding-right:8px;white-space:nowrap;">{escape(label)}</td>'
                f'<td style="white-space:pre-wrap;word-break:break-all;">{escape(val)}</td></tr>'
            )
        if not rows:
            return ""
        header = f'<div style="font-weight:600;margin:2px 0 2px 0;">{escape(role)}</div>'
        return header + '<table style="border-spacing:0;">' + "".join(rows) + "</table>"

    def _refresh_meta_text(self) -> None:
        parts: list[str] = []
        if self.dataset_a:
            html = self._build_meta_html(self.dataset_a, f"A · {self.dataset_a.meta.file_path.name}")
            if html:
                parts.append(html)
        if self.dataset_b:
            html = self._build_meta_html(self.dataset_b, f"B · {self.dataset_b.meta.file_path.name}")
            if html:
                parts.append(html)
        if parts:
            self.meta_text.setText('<div style="line-height:1.35;">' + "<hr>".join(parts) + "</div>")
        else:
            self.meta_text.setText("（暂无元数据）")

    def set_datasets(self, dataset_a: TelemetryDataset | None, dataset_b: TelemetryDataset | None) -> None:
        old_selected = set(self.selected_channels())
        self.dataset_a = dataset_a
        self.dataset_b = dataset_b
        self.items_by_key.clear()
        self.rows_by_key.clear()
        self.channel_order = []
        self.selected_list_widget.clear()
        self.available_list_widget.clear()
        self._update_channel_section_layout(set())
        if not dataset_a:
            self.file_label.setText("未加载文件")
            self._refresh_meta_text()
            return
        if dataset_b:
            self.file_label.setText(f"A: {dataset_a.meta.file_path.name}\nB: {dataset_b.meta.file_path.name}")
            keys = [key for key in dataset_a.header_order if key in dataset_b.channels and key != "Time"]
        else:
            self.file_label.setText(dataset_a.meta.file_path.name)
            keys = [key for key in dataset_a.header_order if key != "Time"]
        self._refresh_meta_text()
        for key in keys:
            meta = self._meta_for_key(key)
            if meta and meta.dtype != "text":
                self.channel_order.append(key)
        selected_set = {key for key in self.channel_order if key in old_selected}
        if not selected_set:
            selected_set = self._default_selected_keys()
        self._rebuild_channel_sections(selected_set)
        self.apply_filter()
        self.selectionChanged.emit()

    def _meta_for_key(self, key: str) -> ChannelMeta | None:
        meta = self.dataset_a.channels.get(key) if self.dataset_a else None
        if not meta and self.dataset_b:
            meta = self.dataset_b.channels.get(key)
        return meta

    def _default_selected_keys(self) -> set[str]:
        preferred = ["L MOTOR SPEED", "R MOTOR SPEED", "Battery Current", "GPS Speed"]
        selected: list[str] = []
        for key in preferred:
            if key in self.channel_order:
                selected.append(key)
                if len(selected) >= 3:
                    break
        if not selected:
            selected = self.channel_order[:3]
        return set(selected)

    def selected_channels(self) -> list[str]:
        return [key for key in self.channel_order if key in self.rows_by_key and self.rows_by_key[key].is_checked()]

    def set_current_values(self, values: dict[str, str]) -> None:
        self.value_cache = values
        for key, row in self.rows_by_key.items():
            row.set_value(values.get(key, ""))

    def apply_filter(self) -> None:
        query = self.search.text().strip().lower()
        for idx in range(self.selected_list_widget.count()):
            self.selected_list_widget.item(idx).setHidden(False)
        visible_available = 0
        for idx in range(self.available_list_widget.count()):
            item = self.available_list_widget.item(idx)
            row = self.rows_by_key.get(item.data(Qt.UserRole))
            hidden = bool(query and row and query not in row.search_blob)
            item.setHidden(hidden)
            if not hidden:
                visible_available += 1
        self._update_channel_section_layout(set(self.selected_channels()), visible_available=visible_available)

    def _rebuild_channel_sections(self, selected_set: set[str]) -> None:
        selected_set = {key for key in self.channel_order if key in selected_set}
        self.selected_list_widget.setUpdatesEnabled(False)
        self.available_list_widget.setUpdatesEnabled(False)
        try:
            self.items_by_key.clear()
            self.rows_by_key.clear()
            self.selected_list_widget.clear()
            self.available_list_widget.clear()
            for key in self.channel_order:
                self._add_channel_row(key, selected=key in selected_set)
        finally:
            self.selected_list_widget.setUpdatesEnabled(True)
            self.available_list_widget.setUpdatesEnabled(True)
        self._update_channel_section_layout(selected_set)

    def _add_channel_row(self, key: str, *, selected: bool) -> None:
        meta = self._meta_for_key(key)
        if not meta:
            return
        item = QListWidgetItem()
        item.setData(Qt.UserRole, key)
        item.setFlags(item.flags() | Qt.ItemIsEnabled | Qt.ItemIsSelectable)
        color_index = self.channel_order.index(key) if key in self.channel_order else len(self.items_by_key)
        row = ChannelRow(key, meta, COLORS[color_index % len(COLORS)])
        row.set_checked(selected, block_signal=True)
        row.set_value(self.value_cache.get(key, ""))
        row.toggled.connect(self._row_toggled)
        item.setSizeHint(row.minimumSizeHint().expandedTo(row.sizeHint()))
        item.setSizeHint(item.sizeHint().expandedTo(pg.QtCore.QSize(0, 24)))
        target = self.selected_list_widget if selected else self.available_list_widget
        target.addItem(item)
        target.setItemWidget(item, row)
        self.items_by_key[key] = item
        self.rows_by_key[key] = row

    def _update_channel_section_layout(self, selected_set: set[str], *, visible_available: int | None = None) -> None:
        selected_count = len(selected_set)
        has_selected = selected_count > 0
        self.selected_list_widget.setVisible(has_selected)
        self.channel_separator.setVisible(has_selected)
        self.selected_list_widget.setMaximumHeight(self._channel_list_height(selected_count) if has_selected else 0)
        self.selected_list_widget.updateGeometry()
        self.channel_section.updateGeometry()

    def _channel_list_height(self, row_count: int, *, max_rows: int = 8) -> int:
        if row_count <= 0:
            return 0
        row_height = 28
        chrome = max(4, self.selected_list_widget.frameWidth() * 2 + 4)
        return min(row_count, max_rows) * row_height + chrome

    def _row_toggled(self, key: str, checked: bool) -> None:
        if not self._updating:
            selected_set = set(self.selected_channels())
            if checked:
                selected_set.add(key)
            else:
                selected_set.discard(key)
            self._rebuild_channel_sections(selected_set)
            self.apply_filter()
            self.selectionChanged.emit()
