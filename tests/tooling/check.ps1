$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'env.ps1')
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$env:PATH = "$env:USERPROFILE\.cargo\bin;$root\node_modules\.bin;$env:PATH"
Push-Location $root
try {
  & (Join-Path $PSScriptRoot 'verify-dependencies.ps1')
  $checks = @(
    @{ Name='rustfmt'; Run={ cargo fmt --all -- --check } },
    @{ Name='clippy'; Run={ cargo clippy --locked --workspace --all-targets -- -D warnings } },
    @{ Name='cargo test'; Run={ cargo test --locked --workspace } },
    @{ Name='typescript'; Run={ & "$root/node_modules/.bin/tsc.cmd" --noEmit -p config/frontend/tsconfig.json } },
    @{ Name='eslint'; Run={ & "$root/node_modules/.bin/eslint.cmd" src config/frontend --config config/frontend/eslint.config.js --max-warnings 0 } },
    @{ Name='frontend test'; Run={ & "$root/node_modules/.bin/vitest.cmd" run --config config/frontend/vite.config.ts } },
    @{ Name='frontend build'; Run={ & "$root/node_modules/.bin/vite.cmd" build --config config/frontend/vite.config.ts } },
    @{ Name='golden suite'; Run={ cargo test --locked -p golden-tests } }
  )
  $failed = @()
  foreach ($check in $checks) {
    Write-Host "[CHECK] $($check.Name)"
    $global:LASTEXITCODE = 0
    try {
      & $check.Run
      if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
      Write-Host "[PASS] $($check.Name)"
    } catch {
      $failed += $check.Name
      Write-Host "[FAIL] $($check.Name): $_"
    }
  }
  if ($failed.Count) { throw "Failed gates: $($failed -join ', ')" }
  Write-Host 'All six gates passed.'
} finally { Pop-Location }
