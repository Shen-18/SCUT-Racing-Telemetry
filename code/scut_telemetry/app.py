from __future__ import annotations

import sys

import pyqtgraph as pg
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import QApplication

from .parser import load_telemetry
from .ui.main_window import MainWindow, app_icon_path


def main() -> int:
    if "--smoke-xrk" in sys.argv:
        idx = sys.argv.index("--smoke-xrk")
        if idx + 1 >= len(sys.argv):
            return 2
        load_telemetry(sys.argv[idx + 1], fallback_csv=False)
        return 0

    pg.setConfigOptions(antialias=True, foreground="#F4F4F5")
    app = QApplication(sys.argv)
    app.setApplicationName("SCUT Racing Telemetry")
    app.setOrganizationName("SCUT Racing")
    icon_path = app_icon_path()
    if icon_path:
        app.setWindowIcon(QIcon(str(icon_path)))
    window = MainWindow()
    window.resize(window.settings.main_window_width, window.settings.main_window_height)
    window.show()
    return app.exec()
