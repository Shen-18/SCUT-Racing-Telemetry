"""Absolute minimal pyqtgraph test."""
import sys
import numpy as np
import pyqtgraph as pg
from PySide6.QtWidgets import QApplication

app = QApplication(sys.argv)

# Test with ALL config options off
pg.setConfigOptions(antialias=False, useOpenGL=False)

x = np.arange(100, dtype=np.float64)
y = np.sin(x * 0.1) * 100

# Method 1: PlotWidget directly
pw = pg.PlotWidget(title="PlotWidget - antialias OFF")
pw.plot(x, y, pen=pg.mkPen('r', width=1))
pw.resize(400, 300)
pw.move(0, 0)
pw.show()

# Method 2: PlotWidget with antialias ON
pw2 = pg.PlotWidget(title="PlotWidget - antialias ON")
pg.setConfigOptions(antialias=True)
pw2.plot(x, y, pen=pg.mkPen('g', width=1))
pw2.resize(400, 300)
pw2.move(420, 0)
pw2.show()

# Method 3: pg.plot shortcut
pg.setConfigOptions(antialias=False)
p3 = pg.plot(x, y, pen='b', title="pg.plot shortcut")
p3.resize(400, 300)
p3.move(0, 350)

print("All windows shown")
sys.stdout.flush()
sys.exit(app.exec())
