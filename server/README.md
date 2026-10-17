# SCUT 云端服务

Node.js HTTP + PostgreSQL 16 的数据分发和软件发布服务，包含管理员网页。原文件/安装器存磁盘 uploads，SQL 保存索引、日期备注、账号、会话、客户端令牌与发布记录。当前已实现管理员登录和接口鉴权，普通桌面客户端只读取。

环境变量：SCUT_DATABASE_URL、SCUT_SYNC_HOST（默认 127.0.0.1）、SCUT_SYNC_PORT（默认 8787）、SCUT_ADMIN_PASSWORD、上传根目录 SCUT_UPLOAD_ROOT（storage.mjs，默认 server/data/uploads）、部署用 SCUT_DATA_DIR / SCUT_DB_PASSWORD；详见 [.env.example](.env.example)、config.mjs 与 storage.mjs。

## 本地启动

需要 Node.js 22、pnpm 和可用的 PostgreSQL；自动启动数据库时还需要 Docker Desktop。

凭据由本地 `.secrets/server.env` 或环境变量提供，配置变量参照 [.env.example](.env.example)。至少配置 SCUT_DATABASE_URL；管理入口配置 SCUT_ADMIN_PASSWORD，Docker 数据库另需 SCUT_DB_PASSWORD。真实值不写入共享文档。start-server.ps1 加载本地配置，Node config.mjs 也支持加载该文件。

```powershell
pwsh server/start-server.ps1 -StartDatabase
# PostgreSQL 已运行时：
pnpm server:start
```

管理网页：`http://127.0.0.1:8787/admin`。健康检查 `/health` 只说明服务和数据库可连接；客户端读接口还要 Bearer 密钥。

## 容器部署

server/ 是 Docker 构建上下文。Dockerfile 需要已有 `bin/xrk-meta`（Linux x86_64 musl），不自动编译 Rust。解析器源码在 crates/xrk-meta；Windows 本机交叉编译可使用已配置的目标和 rust-lld：

```powershell
rustup target add x86_64-unknown-linux-musl
$env:RUSTFLAGS = "-C linker=rust-lld"
cargo build -p xrk-meta --release --target x86_64-unknown-linux-musl
New-Item -ItemType Directory -Path server/bin -Force
Copy-Item target/x86_64-unknown-linux-musl/release/xrk-meta server/bin/xrk-meta
Remove-Item Env:RUSTFLAGS
```

上传 server 的代码和 bin 到服务器部署目录，保留服务器 .env 和数据目录。compose 从部署环境读取 SCUT_DB_PASSWORD、SCUT_ADMIN_PASSWORD，可用 SCUT_DATA_DIR 指定数据存放位置。数据库用户名/库名与连接串按 compose 配套配置。

```bash
cd /opt/SCUTRacing/app
sudo docker compose up -d --build
sudo docker compose logs --tail=50 app
```

首次部署也可使用 sudo bash deploy.sh；脚本可安装 Docker、配置镜像加速并等待健康检查。代码烘焙在镜像中，上传新代码之后必须重建容器。

宿主机 80/8787 映射到应用 8787，PostgreSQL 只映射 127.0.0.1:5432；容器内部通过 compose 网络访问数据库。data/postgres 与 data/uploads 独立挂载，改代码不覆盖数据。

## 操作与发布

管理员可以上传 XRK/XRZ、查看解析出的记录、归档/删除、维护共享日期备注、管理账号和访问密钥。DELETE 记录会移除 SQL 索引并尝试删除关联文件。

软件发布：创建草稿 → 上传 NSIS setup.exe → 上传对应 .sig → 发布；桌面端校验更新签名。当前源码由用户 Base URL 拼接更新端点，旧发布客户端可能仍固定使用 8787，需要迁移兼容。

完整接口、同步边界、线上核查日期及运维待办见 [发布与同步](../.agent/发布与同步.md)。历史设计与记录见 [归档](../.agent/archive/2026-10-09/README.md)；测试结果以对应时间的运行记录为准。
