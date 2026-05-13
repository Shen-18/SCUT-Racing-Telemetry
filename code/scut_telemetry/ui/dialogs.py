from __future__ import annotations

import subprocess
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..library import (
    RunRecord,
    format_chinese_date,
    format_run_time,
)
from ..settings import DEFAULT_PROFILES, AppSettings, DisplayProfile, default_library_root, save_settings, setting_md_path


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

        interaction_tab = QWidget()
        interaction_layout = QVBoxLayout(interaction_tab)
        interaction_layout.setContentsMargins(12, 12, 12, 12)
        interaction_layout.setSpacing(6)
        interaction_layout.addWidget(QLabel("分析页通道列表上方元数据面板"))
        self.metadata_expanded_check = QCheckBox("默认展开元数据面板")
        self.metadata_expanded_check.setChecked(settings.metadata_panel_expanded)
        interaction_layout.addWidget(self.metadata_expanded_check)
        interaction_layout.addWidget(QLabel("显示哪些字段（取消勾选可隐藏）"))
        self._metadata_field_checks: dict[str, QCheckBox] = {}
        active_fields = {f.strip() for f in (settings.metadata_panel_fields or "").split(",") if f.strip()}
        for key, label in METADATA_FIELD_LABELS:
            cb = QCheckBox(label)
            cb.setChecked(key in active_fields)
            interaction_layout.addWidget(cb)
            self._metadata_field_checks[key] = cb
        interaction_layout.addStretch(1)

        tabs.addTab(system_tab, "系统")
        tabs.addTab(file_tab, "文件")
        tabs.addTab(interaction_tab, "界面")
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
            metadata_panel_expanded=self.metadata_expanded_check.isChecked(),
            metadata_panel_fields=",".join(
                key for key, _ in METADATA_FIELD_LABELS if self._metadata_field_checks[key].isChecked()
            ),
            display_profile=profile,
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
        self.table.setColumnCount(3)
        self._update_time_header()
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setWordWrap(False)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setStretchLastSection(False)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Fixed)
        self.table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Fixed)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
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
        labels = ["跑动时间", "赛车手", "车辆"]
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
                font = item.font()
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
