@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SCUT Racing Telemetry - build

echo [1/3] Building frontend (vite)...
call pnpm build
if errorlevel 1 (
  echo [X] Frontend build failed.
  pause
  exit /b 1
)

echo [2/3] Locating Rust toolchain...
if exist "%USERPROFILE%\.cargo\bin" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 (
  echo [X] cargo not found. Install Rust via rustup first.
  pause
  exit /b 1
)

echo [3/3] Building release executable (several minutes)...
cargo build --release -p scut-racing-telemetry --features custom-protocol
if errorlevel 1 (
  echo [X] Rust build failed.
  pause
  exit /b 1
)

echo.
echo [OK] Build complete. Double-click start.cmd to launch the app.
pause
exit /b 0
