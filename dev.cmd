@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SCUT Racing Telemetry - dev

echo.
echo  ================================================
echo   SCUT Racing Telemetry  -  dev launcher
echo   Project: %CD%
echo  ================================================
echo.

rem ---------- 1) Node.js ----------
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist "D:\Dev\nodejs\node.exe" set "PATH=D:\Dev\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js not found. Please install Node.js 18+ and run this script again.
  goto :fail
)
for /f "delims=" %%v in ('node --version') do echo [OK] Node %%v

rem ---------- 2) Rust / cargo (required by tauri dev) ----------
if exist "%USERPROFILE%\.cargo\bin" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >nul 2>nul
if errorlevel 1 (
  echo [X] cargo not found. Please install Rust via rustup first: https://rustup.rs
  goto :fail
)
for /f "delims=" %%v in ('cargo --version') do echo [OK] %%v

rem ---------- 3) pnpm: PATH, then npm global dir, then corepack fallback ----------
set "PNPM_CMD="
where pnpm >nul 2>nul && set "PNPM_CMD=pnpm"
if not defined PNPM_CMD if exist "%APPDATA%\npm\pnpm.cmd" (
  set "PATH=%APPDATA%\npm;%PATH%"
  set "PNPM_CMD=pnpm"
)
if not defined PNPM_CMD (
  echo [i] pnpm not on PATH, trying corepack bundled with Node.js...
  where corepack >nul 2>nul && set "PNPM_CMD=corepack pnpm"
)
if not defined PNPM_CMD (
  echo [X] pnpm not found and corepack unavailable. Run this then retry:
  echo     npm install -g pnpm
  goto :fail
)

echo [OK] Starting tauri dev - first Rust build may take a few minutes...
echo.

%PNPM_CMD% dev
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [OK] Exited normally.
) else (
  echo [X] Exited with code %EXITCODE%. Send the full log above for diagnosis.
)
goto :end

:fail
set "EXITCODE=1"

:end
echo.
pause
exit /b %EXITCODE%
