param([string]$Phase = 'red')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/env.ps1"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
$log = Join-Path $root ".agent/evidence/step2/$Phase.log"
Start-Transcript -Path $log -Force
try {
  cargo test -p telemetry-core --all-features --no-fail-fast
  $code = $LASTEXITCODE
  Write-Host "CORE_TEST_EXIT=$code"
} finally { Stop-Transcript }
exit $code

