param(
  [switch]$StartDatabase
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$credentialFile = Join-Path $root ".secrets\server.env"
if (Test-Path -LiteralPath $credentialFile) {
  foreach ($line in Get-Content -LiteralPath $credentialFile) {
    if ($line -match '^\s*([A-Z_][A-Z_0-9]*)=(.*)$') {
      $name = $Matches[1]
      $value = $Matches[2].Trim()
      if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }
}
if (-not $env:SCUT_DATABASE_URL) {
  throw "请在本地 .secrets/server.env 中配置 SCUT_DATABASE_URL。"
}

if ($StartDatabase) {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw "未找到 Docker。请安装 Docker Desktop，或先手动启动 PostgreSQL，再运行此脚本。"
  }
  docker compose -f server/docker-compose.yml up -d postgres
  if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 容器启动失败。" }
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker compose -f server/docker-compose.yml exec -T postgres pg_isready -U scut -d scut_telemetry *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL 启动超时，请检查 Docker Desktop 日志。" }
}

Write-Host "SCUT 同步服务将使用本地凭据配置中的数据库连接。"
Write-Host "如果数据库尚未启动，请先运行：pwsh server/start-server.ps1 -StartDatabase"
pnpm exec node server/local-server.mjs
