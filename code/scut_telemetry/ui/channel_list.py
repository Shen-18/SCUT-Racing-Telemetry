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
        self.search.setPlaceholderText("搜索通道或单位")
        self.search.textChanged.connect(self.apply_filter)
        self.list_widget = QListWidget()

        layout.addWidget(title)
        layout.addWidget(self.file_label)
        layout.addWidget(self.meta_toggle)
        layout.addWidget(self.meta_panel)
        layout.addWidget(self.search)
        layout.addWidget(self.list_widget, 1)

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
        self.list_widget.clear()
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
