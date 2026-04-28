from __future__ import annotations

from dataclasses import dataclass

import pyqtgraph as pg
from PySide6.QtGui import QColor, QPalette
from PySide6.QtWidgets import QApplication

from ..settings import DEFAULT_PROFILES, DisplayProfile


@dataclass(frozen=True)
class Theme:
    name: str
    background: str
    panel: str
    panel_hover: str
    border: str
    text: str
    text_muted: str
    accent: str
    grid: str
    plot_background: str
    warning: str
    green: str
    red: str


LIGHT = Theme(
    name="light",
    background="#F7F8FA",
    panel="#FFFFFF",
    panel_hover="#F2F4F7",
    border="#E5E7EB",
    text="#111827",
    text_muted="#6B7280",
    accent="#5E6AD2",
    grid="#E5E7EB",
    plot_background="#FFFFFF",
    warning="#C2410C",
    green="#16A34A",
    red="#DC2626",
)

DARK = Theme(
    name="dark",
    background="#0F1115",
    panel="#171A21",
    panel_hover="#202532",
    border="#2A2F3A",
    text="#F4F4F5",
    text_muted="#9CA3AF",
    accent="#8B93FF",
    grid="#2A2F3A",
    plot_background="#111318",
    warning="#F59E0B",
    green="#22C55E",
    red="#F87171",
)


def apply_theme(app: QApplication, theme: Theme, profile: DisplayProfile | None = None) -> None:
    profile = profile or DEFAULT_PROFILES["medium"]
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(theme.background))
    palette.setColor(QPalette.WindowText, QColor(theme.text))
    palette.setColor(QPalette.Base, QColor(theme.panel))
    palette.setColor(QPalette.AlternateBase, QColor(theme.panel_hover))
    palette.setColor(QPalette.Text, QColor(theme.text))
    palette.setColor(QPalette.Button, QColor(theme.panel))
    palette.setColor(QPalette.ButtonText, QColor(theme.text))
    palette.setColor(QPalette.Highlight, QColor(theme.accent))
    palette.setColor(QPalette.HighlightedText, QColor("#FFFFFF"))
    app.setPalette(palette)
    app.setStyleSheet(qss(theme, profile))
    pg.setConfigOptions(background=theme.plot_background, foreground=theme.text)


def qss(theme: Theme, profile: DisplayProfile | None = None) -> str:
    profile = profile or DEFAULT_PROFILES["medium"]
    return f"""
QMainWindow, QWidget {{
    background: {theme.background};
    color: {theme.text};
    font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
    font-size: {profile.base_font}px;
}}
QFrame#Panel {{
    background: {theme.panel};
    border: 1px solid {theme.border};
    border-radius: 8px;
}}
QFrame#TopBar {{
    background: {theme.panel};
    border: 1px solid {theme.border};
    border-radius: 8px;
}}
QFrame#ToolGroup {{
    background: {theme.panel_hover};
    border: 1px solid {theme.border};
    border-radius: 7px;
}}
QLabel#Title {{
    font-size: {profile.title_font}px;
    font-weight: 600;
}}
QLabel#LibraryHeading {{
    font-size: {profile.library_heading_font}px;
    font-weight: 700;
}}
QLabel#LibrarySection {{
    color: {theme.text_muted};
    font-size: {profile.library_section_font}px;
    font-weight: 700;
    padding: 4px 2px;
}}
QLabel#Muted {{
    color: {theme.text_muted};
}}
QLabel#ChannelName {{
    font-size: {profile.channel_font}px;
}}
QLabel#ChannelUnit, QLabel#ChannelValue {{
    color: {theme.text_muted};
    font-size: {profile.channel_font}px;
}}
QLabel#TimeBadge {{
    background: {theme.panel_hover};
    color: {theme.text};
    border: 1px solid {theme.accent};
    border-radius: 7px;
    padding: 5px 12px;
    font-size: {profile.time_badge_font}px;
    font-weight: 700;
}}
QPushButton, QToolButton {{
    background: {theme.panel};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    padding: 5px 9px;
}}
QPushButton:hover, QToolButton:hover {{
    background: {theme.panel_hover};
}}
QPushButton:pressed, QToolButton:pressed {{
    border-color: {theme.accent};
}}
QPushButton#Primary {{
    background: {theme.accent};
    color: #FFFFFF;
    border-color: {theme.accent};
}}
QPushButton#FlatNav {{
    text-align: left;
    font-size: {profile.library_font}px;
    font-weight: 700;
    padding: 7px 9px;
    background: {theme.panel_hover};
}}
QLineEdit, QComboBox, QDoubleSpinBox {{
    background: {theme.panel};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    padding: 5px 8px;
}}
QListWidget, QTextEdit, QTreeWidget, QTableWidget {{
    background: {theme.panel};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    outline: none;
}}
QTreeWidget#LibraryTree, QTableWidget#LibraryTable {{
    font-size: {profile.library_font}px;
    gridline-color: {theme.border};
    alternate-background-color: {theme.panel_hover};
}}
QTreeWidget#LibraryTree::item, QTableWidget#LibraryTable::item {{
    min-height: {profile.library_item_height}px;
    padding: 2px 7px;
}}
QHeaderView::section {{
    background: {theme.panel};
    color: {theme.text};
    border: 0;
    border-bottom: 1px solid {theme.border};
    border-right: 1px solid {theme.border};
    padding: 5px 8px;
    font-size: {profile.header_font}px;
    font-weight: 700;
}}
QTreeWidget#LibraryTree::item:selected, QTableWidget#LibraryTable::item:selected {{
    background: {theme.panel_hover};
    color: {theme.text};
    border-left: 3px solid {theme.accent};
}}
QTextEdit#StatsPanel {{
    padding: 8px;
}}
QListWidget::item {{
    min-height: 24px;
    padding: 0 3px;
    border-bottom: 1px solid {theme.border};
}}
QListWidget::item:hover {{
    background: {theme.panel_hover};
}}
QListWidget::item:selected {{
    background: {theme.panel_hover};
    color: {theme.text};
}}
QCheckBox::indicator {{
    width: 13px;
    height: 13px;
    border-radius: 3px;
    border: 1px solid {theme.border};
    background: {theme.panel};
}}
QCheckBox::indicator:checked {{
    background: {theme.accent};
    border-color: {theme.accent};
}}
QSplitter::handle {{
    background: {theme.border};
}}
QScrollArea {{
    border: none;
}}
QSlider::groove:horizontal {{
    height: 4px;
    background: {theme.border};
    border-radius: 2px;
}}
QSlider::handle:horizontal {{
    background: {theme.accent};
    width: 14px;
    margin: -5px 0;
    border-radius: 7px;
}}
"""
