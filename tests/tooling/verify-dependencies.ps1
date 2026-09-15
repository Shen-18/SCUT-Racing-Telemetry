$ErrorActionPreference = 'Stop'
python (Join-Path $PSScriptRoot 'verify_dependencies.py')
if ($LASTEXITCODE -ne 0) { throw 'Dependency contract violation' }
python (Join-Path $PSScriptRoot 'tests/test_dependencies.py')
if ($LASTEXITCODE -ne 0) { throw 'Dependency guard regression tests failed' }
