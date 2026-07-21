$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$distApp = Join-Path $PSScriptRoot "dist\SCUTRacingTelemetry"
$backupRoot = Join-Path $env:TEMP ("SCUTRacingTelemetry_preserve_" + [guid]::NewGuid().ToString("N"))
$stablePreserveRoot = Join-Path $PSScriptRoot ".build-preserve"
$preserveItems = @("library")
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stablePreserveRoot -Force | Out-Null

function Test-PreservedLibraryHasFiles {
    param([string]$Path)
    $filesDir = Join-Path $Path "files"
    if (-not (Test-Path $filesDir)) { return $false }
    return $null -ne (Get-ChildItem -LiteralPath $filesDir -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)
}

foreach ($item in $preserveItems) {
    $source = Join-Path $distApp $item
    $backupDestination = Join-Path $backupRoot $item
    $stableDestination = Join-Path $stablePreserveRoot $item
    if (Test-Path $source) {
        Copy-Item -LiteralPath $source -Destination $backupDestination -Recurse -Force
        if ($item -ne "library" -or (Test-PreservedLibraryHasFiles $source)) {
            if (Test-Path $stableDestination) {
                Remove-Item -LiteralPath $stableDestination -Recurse -Force
            }
            Copy-Item -LiteralPath $source -Destination $stableDestination -Recurse -Force
        }
    }
    if ($item -eq "library" -and -not (Test-PreservedLibraryHasFiles $backupDestination) -and (Test-PreservedLibraryHasFiles $stableDestination)) {
        if (Test-Path $backupDestination) {
            Remove-Item -LiteralPath $backupDestination -Recurse -Force
        }
        Copy-Item -LiteralPath $stableDestination -Destination $backupDestination -Recurse -Force
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
        $stableDestination = Join-Path $stablePreserveRoot $item
        if ($item -eq "library" -and -not (Test-PreservedLibraryHasFiles $source) -and (Test-PreservedLibraryHasFiles $stableDestination)) {
            $source = $stableDestination
        }
        if (Test-Path $source) {
            $destination = Join-Path $distApp $item
            if (Test-Path $destination) {
                Remove-Item -LiteralPath $destination -Recurse -Force
            }
            Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
            if ($item -eq "library" -and (Test-PreservedLibraryHasFiles $destination)) {
                if (Test-Path $stableDestination) {
                    Remove-Item -LiteralPath $stableDestination -Recurse -Force
                }
                Copy-Item -LiteralPath $destination -Destination $stableDestination -Recurse -Force
            }
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
