$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$results = @()
$overallExitCode = 0

function Write-StepResult {
    param([string]$Name, [string]$Status, [double]$Seconds)
    $color = if ($Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("[{0}] {1} ({2:F1}s)" -f $Status, $Name, $Seconds) -ForegroundColor $color
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$ScriptBlock)
    Write-Host "Running: $Name" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $ScriptBlock
        $elapsed = $sw.Elapsed.TotalSeconds
        if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
            $results += [PSCustomObject]@{ Name = $Name; Status = "FAIL"; Seconds = $elapsed }
            Write-StepResult $Name "FAIL" $elapsed
            if ($overallExitCode -eq 0) { $global:overallExitCode = $LASTEXITCODE }
        } else {
            $results += [PSCustomObject]@{ Name = $Name; Status = "PASS"; Seconds = $elapsed }
            Write-StepResult $Name "PASS" $elapsed
        }
    } catch {
        $elapsed = $sw.Elapsed.TotalSeconds
        $results += [PSCustomObject]@{ Name = $Name; Status = "FAIL"; Seconds = $elapsed }
        Write-Host "  Error: $_" -ForegroundColor Red
        Write-StepResult $Name "FAIL" $elapsed
        if ($overallExitCode -eq 0) { $global:overallExitCode = 1 }
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SCUT Racing Telemetry — Quality Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Tests ─────────────────────────────────────────────
Invoke-Step "pytest" {
    python -m pytest tests/ -v
}

# ── Step 2: Import check ──────────────────────────────────────
Invoke-Step "Import check" {
    python -c "from scut_telemetry.app import main; print('Import OK')"
}

# ── Step 3: Syntax check ──────────────────────────────────────
Invoke-Step "compileall" {
    python -m compileall scut_telemetry/ -q
}

# ── Step 4: Build ─────────────────────────────────────────────
Invoke-Step "Build" {
    $loc = Get-Location
    & .\build.ps1
    Set-Location $loc
}

# ── Summary ───────────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
foreach ($r in $results) {
    $color = if ($r.Status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1} ({2:F1}s)" -f $r.Status, $r.Name, $r.Seconds) -ForegroundColor $color
}

if ($overallExitCode -eq 0) {
    Write-Host ""
    Write-Host "  All checks passed." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  One or more checks failed." -ForegroundColor Red
}

exit $overallExitCode
