@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SCUT Racing Telemetry

set "EXE=target\release\scut-racing-telemetry.exe"

if not exist "%EXE%" (
  echo [X] Program not built yet: %EXE%
  echo     Run build.cmd once to compile, then start.cmd again.
  echo.
  pause
  exit /b 1
)

start "" "%EXE%"
exit /b 0
