from __future__ import annotations

import subprocess
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMenu,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ..comments import (
    add_comment as add_comment_to_note,
    delete_comment as delete_comment_from_note,
    update_comment as update_comment_in_note,
)
from ..library import (
    ImportSummary,
    RunRecord,
    TelemetryLibrary,
    format_chinese_date,
    format_run_time,
    record_note_text,
    safe_filename,
    sha256_file,
)
from ..settings import AppSettings, DisplayProfile, DEFAULT_PROFILES
from .comments_panel import CommentsPanel
from .workers import LibraryImportWorker, _CallableWorker

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
        self.refresh_button.clicked.connect(lambda: self.refresh_records(deep=True))
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
        self.run_table.setColumnCount(3)
        self._update_time_header()
        self.run_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.run_table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.run_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.run_table.setWordWrap(False)
        self.run_table.verticalHeader().setVisible(False)
        self.run_table.horizontalHeader().setStretchLastSection(False)
        self.run_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Fixed)
        self.run_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Fixed)
        self.run_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.run_table.horizontalHeader().setSectionsClickable(True)
        self.run_table.horizontalHeader().sectionClicked.connect(self._header_clicked)
        self.run_table.setColumnWidth(0, 96)
        self.run_table.setColumnWidth(1, 150)
        self.run_table.setColumnWidth(2, 130)
        self.run_table.cellDoubleClicked.connect(self._open_row)
        self.run_table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.run_table.customContextMenuRequested.connect(self._show_context_menu)
        self.run_table.itemSelectionChanged.connect(self._selected_row_changed)
        right_splitter = QSplitter(Qt.Horizontal)
        table_host = QFrame()
        table_host_layout = QVBoxLayout(table_host)
        table_host_layout.setContentsMargins(0, 0, 0, 0)
        table_host_layout.addLayout(header_row)
        table_host_layout.addWidget(self.run_table)
        right_splitter.addWidget(table_host)
        self.comments_panel = CommentsPanel()
        self.comments_panel.commentAdded.connect(self._on_comment_added)
        self.comments_panel.commentEdited.connect(self._on_comment_edited)
        self.comments_panel.commentDeleted.connect(self._on_comment_deleted)
        right_splitter.addWidget(self.comments_panel)
        right_splitter.setStretchFactor(0, 3)
        right_splitter.setStretchFactor(1, 1)
        right_layout.addWidget(right_splitter, 1)
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
        self.refresh_records(deep=True)

    def set_display_profile(self, profile: DisplayProfile) -> None:
        self.display_profile = profile
        self._fill_table()

    def set_settings(self, settings: AppSettings) -> None:
        self.settings = settings

    def refresh_records(self, *, deep: bool = False) -> None:
        pruned = self.library.prune_missing_records()
        repaired = self.library.repair_filename_metadata() if deep else 0
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
        self.home_status.setText("正在后台导出...")
        self._export_worker = _CallableWorker(self.library.export_records_zip, records, Path(filename), True)
        self._export_worker.finishedResult.connect(self._on_export_finished)
        self._export_worker.finished.connect(self._export_worker.deleteLater)
        self._export_worker.start()

    def _on_export_finished(self, result: object) -> None:
        if isinstance(result, Exception):
            QMessageBox.critical(self, "导出失败", str(result))
            self.home_status.setText("导出失败")
            return
        count = result
        self.home_status.setText(f"已导出 {count} 个 CSV")

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
        labels = ["跑动时间", "赛车手", "车辆"]
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
                font = item.font()
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

    def _selected_row_changed(self) -> None:
        ids = self.selected_record_ids()
        if not ids:
            self.comments_panel.set_record(None, "")
            return
        record = self.library.get_record(ids[0])
        if not record:
            self.comments_panel.set_record(None, "")
            return
        text = (record.note_body or "").strip()
        if record.note_title and not text.startswith(record.note_title):
            text = (record.note_title + ("\n" + text if text else "")).strip() if text else record.note_title
        self.comments_panel.set_record(record.id, text)

    def _on_comment_added(self, record_id: str, author: str, text: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        existing_text = (record.note_body or "").strip()
        if record.note_title and not existing_text:
            existing_text = record.note_title
        new_body = add_comment_to_note(existing_text, author, text)
        self._save_record_note(record_id, record.note_title, new_body)

    def _on_comment_edited(self, record_id: str, comment_index: int, author: str, text: str) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        existing_text = (record.note_body or "").strip()
        new_body = update_comment_in_note(existing_text, comment_index, author, text)
        self._save_record_note(record_id, record.note_title, new_body)

    def _on_comment_deleted(self, record_id: str, comment_index: int) -> None:
        record = self.library.get_record(record_id)
        if not record:
            return
        existing_text = (record.note_body or "").strip()
        new_body = delete_comment_from_note(existing_text, comment_index)
        self._save_record_note(record_id, record.note_title, new_body)

    def _save_record_note(self, record_id: str, title: str, body: str) -> None:
        self.library.update_note(record_id, title, body)
        self._sync_worker = _CallableWorker(self.library.sync_record_comment_to_csv, record_id)
        self._sync_worker.finishedResult.connect(lambda r: self._on_sync_done(r, record_id))
        self._sync_worker.finished.connect(self._sync_worker.deleteLater)
        self._sync_worker.start()

    def _on_sync_done(self, result: object, record_id: str) -> None:
        if isinstance(result, Exception):
            QMessageBox.warning(self, "同步评论失败", str(result))
        self.refresh_records()
        for r in range(self.run_table.rowCount()):
            if self.record_id_at_row(r) == record_id:
                self.run_table.selectRow(r)
                break

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
        self._save_record_note(record_id, title, body)

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
