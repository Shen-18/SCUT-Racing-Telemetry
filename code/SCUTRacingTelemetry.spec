# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = []
hiddenimports += collect_submodules('pyqtgraph')


a = Analysis(
    ['scut_telemetry\\__main__.py'],
    pathex=['.'],
    binaries=[('..\\TestMatLabXRK\\DLL-2022\\MatLabXRK-2022-64-ReleaseU.dll', 'TestMatLabXRK\\DLL-2022'), ('..\\TestMatLabXRK\\64\\libiconv-2.dll', 'TestMatLabXRK\\64'), ('..\\TestMatLabXRK\\64\\libxml2-2.dll', 'TestMatLabXRK\\64'), ('..\\TestMatLabXRK\\64\\libz.dll', 'TestMatLabXRK\\64'), ('..\\TestMatLabXRK\\64\\pthreadVC2_x64.dll', 'TestMatLabXRK\\64'), ('C:\\WINDOWS\\WinSxS\\amd64_microsoft.vc90.crt_1fc8b3b9a1e18e3b_9.0.30729.9635_none_08e2c157a83ed5da\\msvcr90.dll', 'TestMatLabXRK\\64')],
    datas=[('..\\Data\\SCUTRacing.ico', 'Data')],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SCUTRacingTelemetry',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['..\\Data\\SCUTRacing.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='SCUTRacingTelemetry',
)
