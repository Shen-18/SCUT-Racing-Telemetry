import sys
import time
from scut_telemetry.parser import load_telemetry
from scut_telemetry.ui.main_window import MainWindow
from PySide6.QtWidgets import QApplication

def main():
    app = QApplication(sys.argv)
    
    t0 = time.time()
    dataset = load_telemetry("../Data/test.xrk")
    t1 = time.time()
    print(f"Load time: {t1 - t0:.2f}s")
    
    win = MainWindow()
    win.dataset_a = dataset
    win.channel_list.set_datasets(dataset, None)
    
    t2 = time.time()
    win.refresh_all(reset_window=True)
    t3 = time.time()
    print(f"Refresh time: {t3 - t2:.2f}s")

if __name__ == "__main__":
    main()
