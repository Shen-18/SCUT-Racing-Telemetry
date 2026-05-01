$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$distApp = Join-Path $PSScriptRoot "dist\SCUTRacingTelemetry"
$backupRoot = Join-Path $env:TEMP ("SCUTRacingTelemetry_preserve_" + [guid]::NewGuid().ToString("N"))
$preserveItems = @("library")
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

foreach ($item in $preserveItems) {
    $source = Join-Path $distApp $item
    if (Test-Path $source) {
        Copy-Item -LiteralPath $source -Destination (Join-Path $backupRoot $item) -Recurse -Force
    }
}

$dllMain = "..\TestMatLabXRK\DLL-2022\MatLabXRK-2022-64-ReleaseU.dll"
$dllDeps = @(
    "..\TestMatLabXRK\64\libiconv-2.dll",
    "..\TestMatLabXRK\64\libxml2-2.dll",
    "..\TestMatLabXRK\64\libz.dll",
    "..\TestMatLabXRK\64\pthreadVC2_x64.dll"
)

$vc90 = Get-ChildItem -Path "$env:WINDIR\WinSxS" -Recurse -Filter "msvcr90.dll" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like "*amd64_microsoft.vc90.crt*" } |
    Select-Object -First 1
if ($vc90) {
    $dllDeps += $vc90.FullName
}

$args = @(
    "--noconfirm",
    "--clean",
    "--name", "SCUTRacingTelemetry",
    "--windowed",
    "--icon", "..\Data\SCUTRacing.ico",
    "--paths", ".",
    "--collect-submodules", "pyqtgraph",
    "--add-data", "..\Data\SCUTRacing.ico;Data",
    "--add-binary", "$dllMain;TestMatLabXRK\DLL-2022"
)

foreach ($dep in $dllDeps) {
    $args += @("--add-binary", "$dep;TestMatLabXRK\64")
}

$args += @("scut_telemetry\__main__.py")

python -m PyInstaller @args

if (Test-Path $distApp) {
    foreach ($item in $preserveItems) {
        $source = Join-Path $backupRoot $item
        if (Test-Path $source) {
            $destination = Join-Path $distApp $item
            if (Test-Path $destination) {
                Remove-Item -LiteralPath $destination -Recurse -Force
            }
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
        }
    }

    foreach ($item in @("setting.md", "settings.json")) {
        $source = Join-Path $PSScriptRoot $item
        if (Test-Path $source) {
            Copy-Item -LiteralPath $source -Destination (Join-Path $distApp $item) -Force
        }
    }

    $releaseReadme = Join-Path $PSScriptRoot "RELEASE_README.md"
    if (Test-Path $releaseReadme) {
        Copy-Item -LiteralPath $releaseReadme -Destination (Join-Path $distApp "README.md") -Force
    }
}

Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Build complete:"
Write-Host "  $PSScriptRoot\dist\SCUTRacingTelemetry\SCUTRacingTelemetry.exe"
