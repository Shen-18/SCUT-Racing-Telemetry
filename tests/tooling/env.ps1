# Configure this process only; never change machine-wide PATH.
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
if ($env:OS -eq 'Windows_NT' -or (Test-Path Variable:\IsWindows -and $IsWindows)) {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if ((Test-Path $vswhere) -and -not (Get-Command link.exe -ErrorAction SilentlyContinue)) {
    $install = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($install) {
      & (Join-Path $install 'Common7/Tools/Launch-VsDevShell.ps1') -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
    }
  }
}
