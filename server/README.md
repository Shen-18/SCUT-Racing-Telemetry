# 测试云端服务

这是 SCUT Racing Telemetry 的本地 PostgreSQL 服务端骨架，包含：

- `schema.sql`：数据集索引和日期备注表；
- `local-server.mjs`：HTTP API 和管理员网页服务；
- `admin-ui/`：管理员管理页面；
- `storage.mjs`：测试阶段的本地原始文件保存；
- `start-server.ps1`：启动脚本；
- `docker-compose.yml`：PostgreSQL 16 + 同步服务两个容器；
- `deploy.sh`：Linux 服务器一键部署脚本。

## 启动

```powershell
pwsh server/start-server.ps1 -StartDatabase
```

如果 PostgreSQL 已经运行：

```powershell
pnpm server:start
```

管理员页面：`http://127.0.0.1:8787/admin`

默认数据库连接串：

```text
postgresql://scut:<DATABASE_PASSWORD>@127.0.0.1:5432/scut_telemetry
```

可通过 `SCUT_DATABASE_URL`、`SCUT_SYNC_HOST`、`SCUT_SYNC_PORT` 和 `SCUT_UPLOAD_ROOT` 覆盖。

当前管理员上传会保存到 `server/data/uploads`，普通客户端只有读取数据集和日期备注的接口。正式部署时，把这个存储适配器替换为对象存储，并为 `/api/v1/admin/*` 增加登录和权限校验。

## 服务器一键部署（Ubuntu）

本机只需要 `scp` 上传目录，服务器不需要访问 GitHub：

```powershell
# 本机 PowerShell
scp -r D:\Desktop\SCUTRacingTelemetry\server root@<服务器IP>:/opt/scut-server
ssh root@<服务器IP>
```

```bash
# 服务器上
bash /opt/scut-server/deploy.sh
```

`deploy.sh` 会自动安装 Docker（如缺失）、配置国内镜像加速、构建并启动 `postgres` + `app` 两个容器，然后等待 `/health` 就绪。容器内数据库只监听 `127.0.0.1`，不暴露公网。

之后在云厂商安全组放行 TCP 8787（建议源地址先只填自己的 IP），桌面端「设置 → 云端服务器」填 `http://<服务器IP>:8787` 测试连接。

更新版本：重新上传后执行 `docker compose up -d --build`；查看日志：`docker compose logs -f app`。

安全注意：`/api/v1/admin/*` 目前无鉴权，公网部署务必用安全组限制 8787 的来源 IP，或尽快补上登录校验；首次启动前可在 `docker-compose.yml` 中把 `POSTGRES_PASSWORD` 与 `SCUT_DATABASE_URL` 成对改为强密码。
