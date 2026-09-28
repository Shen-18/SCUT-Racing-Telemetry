$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
pnpm tauri build
Write-Host "Built executable: $PSScriptRoot\target\release\scut-racing-telemetry.exe"
Write-Host "Built installer: $PSScriptRoot\target\release\bundle\nsis\SCUT Racing Telemetry_1.0.0_x64-setup.exe"
