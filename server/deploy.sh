#!/usr/bin/env bash
# SCUT 同步服务一键部署（Ubuntu 22.04/24.04，首次运行自动安装 Docker）
# 用法：sudo bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(id -u)" != "0" ]; then
  echo "请用 root 运行：sudo bash deploy.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "==> 安装 Docker（阿里云内网 apt 源，通常几十秒）"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y docker.io docker-compose-v2 docker-buildx
  systemctl enable --now docker
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "==> 补装 docker compose 插件"
  apt-get update -y && apt-get install -y docker-compose-v2
fi

# 国内直连 Docker Hub 常超时，配置公共加速镜像；失效时可在
# 阿里云控制台「容器镜像服务 → 镜像加速器」领取专属地址替换
DAEMON_JSON=/etc/docker/daemon.json
if [ ! -f "$DAEMON_JSON" ]; then
  echo "==> 配置镜像加速"
  mkdir -p /etc/docker
  cat > "$DAEMON_JSON" <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run",
    "https://hub.rat.dev"
  ]
}
EOF
  systemctl restart docker
fi

echo "==> 构建并启动（首次拉取基础镜像约 1-3 分钟）"
docker compose up -d --build

echo "==> 等待服务就绪"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo ""
    echo "✅ 部署完成：http://127.0.0.1:8787 （管理页 /admin）"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "❌ 60 秒内未就绪。若日志显示拉取镜像超时，换 daemon.json 里的加速地址后重跑本脚本"
docker compose logs --tail=50
exit 1
