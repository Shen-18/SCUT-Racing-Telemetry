param(
  [switch]$StartDatabase
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:SCUT_DATABASE_URL) {
  $env:SCUT_DATABASE_URL = "postgresql://scut:<DATABASE_PASSWORD>@127.0.0.1:5432/scut_telemetry"
}

if ($StartDatabase) {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw "未找到 Docker。请安装 Docker Desktop，或先手动启动 PostgreSQL，再运行此脚本。"
  }
  docker compose -f server/docker-compose.yml up -d postgres
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker compose -f server/docker-compose.yml exec -T postgres pg_isready -U scut -d scut_telemetry *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "PostgreSQL 启动超时，请检查 Docker Desktop 日志。" }
}

Write-Host "SCUT 同步服务将使用：$($env:SCUT_DATABASE_URL)"
Write-Host "如果数据库尚未启动，请先运行：pwsh server/start-server.ps1 -StartDatabase"
pnpm exec node server/local-server.mjs
