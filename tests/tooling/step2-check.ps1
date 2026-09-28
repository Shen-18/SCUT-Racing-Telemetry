param([string]$Phase = 'red')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$logDir = Join-Path $root "target/test-logs/step2"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$log = Join-Path $logDir "$Phase.log"
Start-Transcript -Path $log -Force
try {
  cargo test -p telemetry-core --all-features --no-fail-fast
  $code = $LASTEXITCODE
  Write-Host "CORE_TEST_EXIT=$code"
} finally { Stop-Transcript }
exit $code

