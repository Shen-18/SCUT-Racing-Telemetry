import sys
import numpy as np
import pyqtgraph as pg
from PySide6.QtWidgets import QApplication
from scut_telemetry.parser import load_telemetry
from scut_telemetry.ui.main_window import MainWindow

def main():
    app = QApplication(sys.argv)
    dataset = load_telemetry("../Data/test.xrk")
    win = MainWindow()
    win.dataset_a = dataset
    win.channel_list.set_datasets(dataset, None)
    win.refresh_all(reset_window=True)
    
    pixmap = win.grab()
    pixmap.save("test_out.png", "PNG")

if __name__ == "__main__":
    main()
