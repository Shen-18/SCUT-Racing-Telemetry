from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ..comments import (
    format_time_for_display,
    split_note,
)


class CommentsPanel(QFrame):
    """Renders structured comments for a record and supports adding/editing/deleting comments."""

    commentAdded = Signal(str, str, str)
    commentEdited = Signal(str, int, str, str)
    commentDeleted = Signal(str, int)

    def __init__(self) -> None:
        super().__init__()
        self.setObjectName("Panel")
        self._record_id: str | None = None
        self._note_text: str = ""

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(6)

        header = QHBoxLayout()
        title = QLabel("评论")
        title.setObjectName("Title")
        header.addWidget(title)
        header.addStretch(1)
        self.count_label = QLabel("")
        self.count_label.setObjectName("Muted")
        header.addWidget(self.count_label)
        layout.addLayout(header)

        self.thread = QListWidget()
        self.thread.setObjectName("CommentsThread")
        self.thread.setMinimumHeight(140)
        self.thread.setAlternatingRowColors(False)
        self.thread.setWordWrap(True)
        self.thread.setSelectionMode(QAbstractItemView.SingleSelection)
        self.thread.setContextMenuPolicy(Qt.CustomContextMenu)
        self.thread.customContextMenuRequested.connect(self._show_comment_menu)
        layout.addWidget(self.thread, 1)

        form = QVBoxLayout()
        form.setSpacing(6)
        self.author_edit = QLineEdit()
        self.author_edit.setPlaceholderText("姓名")
        self.text_edit = QTextEdit()
        self.text_edit.setPlaceholderText("评论内容")
        self.text_edit.setMinimumHeight(68)
        self.send_button = QPushButton("添加评论")
        self.send_button.setObjectName("Primary")
        self.send_button.clicked.connect(self._on_send)
        form.addWidget(self.author_edit)
        form.addWidget(self.text_edit)
        form.addWidget(self.send_button)
        layout.addLayout(form)

        self.set_record(None, "")

    def set_record(self, record_id: str | None, note_text: str) -> None:
        self._record_id = record_id
        self._note_text = note_text or ""
        prefix, comments = split_note(self._note_text)

        def sort_key(item):
            _idx, comment = item
            dt = comment.time_dt()
            return dt.timestamp() if dt else 0.0

        comments_sorted = sorted(list(enumerate(comments)), key=sort_key, reverse=True)
        self.thread.clear()
        if record_id is None:
            self.count_label.setText("")
            self.thread.addItem("选择一条记录后查看评论。")
            self.author_edit.setEnabled(False)
            self.text_edit.setEnabled(False)
            self.send_button.setEnabled(False)
            return

        self.author_edit.setEnabled(True)
        self.text_edit.setEnabled(True)
        self.send_button.setEnabled(True)
        self.count_label.setText(f"{len(comments_sorted)} 条")
        if prefix:
            item = QListWidgetItem(f"备注\n{prefix}")
            item.setFlags(Qt.ItemIsEnabled)
            self.thread.addItem(item)
        if not comments_sorted and not prefix:
            self.thread.addItem("还没有评论。在下方输入姓名和评论内容后添加。")
            return
        for original_idx, comment in comments_sorted:
            time_disp = format_time_for_display(comment.time)
            item = QListWidgetItem(f"@{comment.author}    {time_disp}\n{comment.text}")
            item.setData(Qt.UserRole, original_idx)
            self.thread.addItem(item)

    def set_default_author(self, name: str) -> None:
        if name and not self.author_edit.text().strip():
            self.author_edit.setText(name)

    def _on_send(self) -> None:
        if self._record_id is None:
            return
        author = self.author_edit.text().strip() or "匿名"
        text = self.text_edit.toPlainText().strip()
        if not text:
            return
        self.text_edit.clear()
        self.commentAdded.emit(self._record_id, author, text)

    def _show_comment_menu(self, pos) -> None:
        if self._record_id is None:
            return
        item = self.thread.itemAt(pos)
        if not item:
            return
        original_idx = item.data(Qt.UserRole)
        if original_idx is None:
            return
        _prefix, comments = split_note(self._note_text)
        if original_idx < 0 or original_idx >= len(comments):
            return
        comment = comments[original_idx]
        menu = QMenu(self)
        edit_action = menu.addAction("修改")
        delete_action = menu.addAction("删除")
        action = menu.exec(self.thread.viewport().mapToGlobal(pos))
        if action is edit_action:
            values = self._edit_comment_values(comment.author, comment.text)
            if values is None:
                return
            author, text = values
            self.commentEdited.emit(self._record_id, int(original_idx), author, text)
        elif action is delete_action:
            result = QMessageBox.question(self, "删除评论", "删除这条评论？")
            if result == QMessageBox.Yes:
                self.commentDeleted.emit(self._record_id, int(original_idx))

    def _edit_comment_values(self, current_author: str, current_text: str) -> tuple[str, str] | None:
        dialog = QDialog(self)
        dialog.setWindowTitle("修改评论")
        layout = QVBoxLayout(dialog)
        layout.addWidget(QLabel("姓名"))
        author_edit = QLineEdit(current_author)
        layout.addWidget(author_edit)
        layout.addWidget(QLabel("评论内容"))
        text_edit = QTextEdit()
        text_edit.setPlainText(current_text)
        text_edit.setMinimumHeight(140)
        layout.addWidget(text_edit)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        if dialog.exec() != QDialog.Accepted:
            return None
        author = author_edit.text().strip() or "匿名"
        text = text_edit.toPlainText().strip()
        if not text:
            return None
        return author, text
