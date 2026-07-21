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
    # New Linear-inspired workbench fields
    surface: str
    surface_subtle: str
    surface_active: str
    border_strong: str
    text_soft: str
    accent_hover: str
    selection: str
    success: str


LIGHT = Theme(
    name="light",
    # Linear-inspired light palette
    background="#F5F6F8",
    surface="#FFFFFF",
    surface_subtle="#FAFBFC",
    surface_active="#F1F3F6",
    panel="#FFFFFF",
    panel_hover="#F1F3F6",
    border="#E2E6EA",
    border_strong="#D3D9E0",
    text="#1F2328",
    text_muted="#69707D",
    text_soft="#8B93A1",
    accent="#5E6AD2",
    accent_hover="#4F5BD5",
    selection="#EEF2FF",
    grid="#E2E6EA",
    plot_background="#FFFFFF",
    warning="#C2410C",
    green="#16A34A",
    success="#16A34A",
    red="#DC2626",
)

DARK = Theme(
    name="dark",
    # Linear-inspired dark palette
    background="#15181E",
    surface="#1C1F26",
    surface_subtle="#202430",
    surface_active="#272B36",
    panel="#1C1F26",
    panel_hover="#272B36",
    border="#2E3340",
    border_strong="#3D4352",
    text="#E8EAED",
    text_muted="#949BA8",
    text_soft="#6B7384",
    accent="#7B87FF",
    accent_hover="#8B93FF",
    selection="#252A40",
    grid="#2E3340",
    plot_background="#171A21",
    warning="#F59E0B",
    green="#22C55E",
    success="#22C55E",
    red="#F87171",
)


def apply_theme(app: QApplication, theme: Theme, profile: DisplayProfile | None = None) -> None:
    profile = profile or DEFAULT_PROFILES["medium"]
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(theme.background))
    palette.setColor(QPalette.WindowText, QColor(theme.text))
    palette.setColor(QPalette.Base, QColor(theme.surface))
    palette.setColor(QPalette.AlternateBase, QColor(theme.surface_active))
    palette.setColor(QPalette.Text, QColor(theme.text))
    palette.setColor(QPalette.Button, QColor(theme.surface))
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
    background: {theme.surface};
    border: 1px solid {theme.border};
    border-radius: 6px;
}}
QFrame#TopBar {{
    background: {theme.surface};
    border: 1px solid {theme.border};
    border-radius: 6px;
    padding: 4px 6px;
}}
QFrame#ToolGroup {{
    background: {theme.surface_subtle};
    border: 1px solid {theme.border};
    border-radius: 4px;
}}
QLabel#Title {{
    font-size: {profile.title_font}px;
    font-weight: 600;
}}
QLabel#LibraryHeading {{
    font-size: {profile.library_heading_font}px;
    font-weight: 600;
}}
QLabel#LibrarySection {{
    color: {theme.text_soft};
    font-size: {profile.library_section_font}px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 2px 2px;
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
    background: {theme.selection};
    color: {theme.accent};
    border: 1px solid {theme.accent};
    border-radius: 6px;
    padding: 4px 10px;
    font-size: {profile.time_badge_font}px;
    font-weight: 600;
}}
QPushButton, QToolButton {{
    background: {theme.surface};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    padding: 4px 8px;
}}
QPushButton:hover, QToolButton:hover {{
    background: {theme.surface_active};
    border-color: {theme.border_strong};
}}
QPushButton:pressed, QToolButton:pressed {{
    background: {theme.surface_active};
}}
QPushButton#Primary {{
    background: {theme.accent};
    color: #FFFFFF;
    border: 1px solid {theme.accent};
    border-radius: 6px;
}}
QPushButton#Primary:hover {{
    background: {theme.accent_hover};
}}
QPushButton#FlatNav {{
    text-align: left;
    font-size: {profile.library_font}px;
    font-weight: 600;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
}}
QPushButton#FlatNav:hover {{
    background: {theme.surface_active};
}}
QPushButton#FlatNav:checked {{
    background: {theme.surface_active};
    color: {theme.accent};
}}
QLineEdit, QComboBox, QDoubleSpinBox {{
    background: {theme.surface};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    padding: 4px 8px;
}}
QListWidget, QTextEdit, QTreeWidget, QTableWidget {{
    background: {theme.surface};
    color: {theme.text};
    border: 1px solid {theme.border};
    border-radius: 6px;
    outline: none;
}}
QTreeWidget#LibraryTree, QTableWidget#LibraryTable {{
    font-size: {profile.library_font}px;
    gridline-color: {theme.border};
    alternate-background-color: {theme.surface_subtle};
}}
QTreeWidget#LibraryTree::item, QTableWidget#LibraryTable::item {{
    min-height: {profile.library_item_height}px;
    padding: 2px 7px;
}}
QHeaderView::section {{
    background: {theme.surface};
    color: {theme.text_muted};
    border: none;
    border-bottom: 1px solid {theme.border_strong};
    border-right: 1px solid {theme.border};
    padding: 4px 8px;
    font-size: {profile.header_font}px;
    font-weight: 600;
}}
QTreeWidget#LibraryTree::item:selected, QTableWidget#LibraryTable::item:selected {{
    background: {theme.selection};
    color: {theme.text};
    border-left: 2px solid {theme.accent};
}}
QTextEdit#StatsPanel {{
    padding: 8px;
}}
QListWidget::item {{
    min-height: 24px;
    padding: 0 3px;
    border-bottom: none;
}}
QListWidget::item:hover {{
    background: {theme.surface_active};
}}
QListWidget::item:selected {{
    background: {theme.surface_active};
    color: {theme.text};
}}
QCheckBox::indicator {{
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid {theme.border};
    background: {theme.surface};
}}
QCheckBox::indicator:checked {{
    background: {theme.accent};
    border-color: {theme.accent};
}}
QSplitter::handle {{
    background: {theme.border};
    width: 1px;
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
