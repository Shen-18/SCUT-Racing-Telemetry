# Full bundle build: NSIS installer + updater signature (.sig)
# build:exe (--no-bundle) does NOT produce an installer or .sig.
$ErrorActionPreference = "Stop"
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $scriptDir

# Signing credentials
$keyPath = Join-Path $scriptDir ".secrets\signing\scut-updater.key"
$password = (Get-Content (Join-Path $scriptDir ".secrets\signing\password.txt") -Raw).Trim()

$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Path $keyPath -Raw).Trim()
$env:TAURI_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $password
$env:TAURI_KEY_PASSWORD = $password

try {
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "打包失败，退出码：$LASTEXITCODE" }
} finally {
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_KEY_PASSWORD -ErrorAction SilentlyContinue
}
$version = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
Write-Host "Built executable: $scriptDir\target\release\scut-racing-telemetry.exe"
Write-Host "Built installer:  $scriptDir\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe"
Write-Host "Update signature: $scriptDir\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe.sig"
