$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
pnpm tauri build --no-bundle
Write-Host "Built: $PSScriptRoot\target\release\scut-racing-telemetry.exe"
