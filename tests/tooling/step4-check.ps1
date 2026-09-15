param([switch]$SkipRust)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $root
try {
  $required=@('ImportStage','ImportStatus','FrameHeader','DatasetMeta','ChannelMeta','WindowFrame','generation')
  $text=Get-Content src/api/types.ts -Raw
  foreach($name in $required){if($text -notmatch [regex]::Escape($name)){throw "missing generated TypeScript symbol: $name"}}
  if((Get-Content src-tauri/src/main.rs -Raw) -match '\.sin\('){throw 'synthetic window data remains in Tauri host'}
  if((Get-Content src-tauri/src/main.rs -Raw) -notmatch 'window_series'){throw 'WindowSeries route missing'}
  if(-not $SkipRust){cargo test --locked -p telemetry-ipc --test request --test metadata --test frame --test specta_sync}
  Write-Host 'Step 4 contract sync: PASS'
} finally {Pop-Location}


