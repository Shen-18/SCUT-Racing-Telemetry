$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "target\release\scut-racing-telemetry.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Release executable not found. Run .\build.ps1 first."
}
Start-Process -FilePath $exe
