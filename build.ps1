# Full bundle build: NSIS installer + updater signature (.sig)
# build:exe (--no-bundle) does NOT produce an installer or .sig.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Updater signing key (.keys/ is gitignored; losing it means no more signed updates)
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content (Join-Path $PSScriptRoot ".keys\scut-updater.key") -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content (Join-Path $PSScriptRoot ".keys\password.txt") -Raw).Trim()

pnpm tauri build
$version = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
Write-Host "Built executable: $PSScriptRoot\target\release\scut-racing-telemetry.exe"
Write-Host "Built installer:  $PSScriptRoot\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe"
Write-Host "Update signature: $PSScriptRoot\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe.sig"
