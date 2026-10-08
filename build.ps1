# Full bundle build: NSIS installer + updater signature (.sig)
# build:exe (--no-bundle) does NOT produce an installer or .sig.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 签名凭据仅存于本地 .secrets，不进入 Git 或安装包。
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content (Join-Path $PSScriptRoot ".secrets\signing\scut-updater.key") -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content (Join-Path $PSScriptRoot ".secrets\signing\password.txt") -Raw).Trim()

try {
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "打包失败，退出码：$LASTEXITCODE" }
} finally {
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
$version = (Get-Content src-tauri\tauri.conf.json | ConvertFrom-Json).version
Write-Host "Built executable: $PSScriptRoot\target\release\scut-racing-telemetry.exe"
Write-Host "Built installer:  $PSScriptRoot\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe"
Write-Host "Update signature: $PSScriptRoot\target\release\bundle\nsis\SCUT Racing Telemetry_${version}_x64-setup.exe.sig"
