# 管理面板与访问密钥设计

状态：设计已确认（2026-10-06），待实施。

## 背景与目标

云端同步服务（`server/`，部署于阿里云 Ubuntu 24.04，2C2G，IP `8.134.196.199:8787`，容器化 postgres + app）现有 `/admin` 页面仅支持上传、归档和日期备注维护，且全部接口无鉴权。本设计将其扩展为完整管理面板：

- 管理员登录（密码验证）后管理数据集：删除、下载、编辑备注、归档；
- 生成/吊销队员客户端访问令牌；
- 所有客户端读写接口要求有效令牌；
- 继续通过 `http://<IP>:8787/admin` 在线访问；域名与 HTTPS 留待后续阶段。

实现路线：在现有原生 Node 服务上扩展（方案 A），零新依赖；桌面端同步接入令牌。

## 安全模型

两层验证，互不通用：

| 层 | 凭证 | 保护范围 |
| --- | --- | --- |
| 管理员 | 密码换会话 Cookie（httpOnly，7 天有效） | 全部 `/api/v1/admin/*`（登录接口除外） |
| 队员客户端 | 访问令牌（`Authorization: Bearer`） | `/api/v1/datasets`、`/api/v1/date-notes*` |

- 管理密码来自环境变量 `SCUT_ADMIN_PASSWORD`，未设置时服务启动正常但所有 admin 接口返回明确错误，日志提示去 compose 配置。
- 会话令牌为 32 字节随机数，数据库只存 SHA-256，Cookie 携带原文；`SameSite=Lax`；登出删除会话记录。
- 登录防爆破：同一 IP 连续失败 5 次锁定 10 分钟（内存计数，重启重置）。
- 客户端令牌生成时返回完整值且仅此一次（界面提示复制保存），库中只存 SHA-256 与名称、创建时间、最近使用时间、吊销时间；吊销立即生效。
- 已知限制：当前为明文 HTTP，凭证可被链路嗅探，仅限可信网络使用；接口按 HTTPS-ready 设计，后续接域名 + Caddy 时无需改动 API。

## 数据模型（schema.sql 增量，启动时自动迁移，幂等）

- `datasets` 增加 `note TEXT NOT NULL DEFAULT ''`（数据集备注，区别于日期备注）。
- 新表 `admin_sessions`（token_hash 主键、expires_at）。
- 新表 `client_tokens`（id SERIAL 主键、name、token_hash 唯一、created_at、last_used_at、revoked_at 可空）。
- 删除数据集时同时删除 `server/data/uploads/` 下对应文件（storage_key 存在时）；文件缺失不报错。

## API

新增（admin，除 login 外均需会话 Cookie）：

- `POST /api/v1/admin/login` `{password}` → 设置 Cookie；失败统一报「密码错误」，不区分账号不存在等情形。
- `POST /api/v1/admin/logout`
- `GET /api/v1/admin/files/:storage_key` → 流式下载，校验 key 格式（防目录穿越），`Content-Disposition` 使用原始文件名；不存在返回 404。
- `DELETE /api/v1/admin/datasets/:file_hash` → 删除记录及关联文件，返回删除详情；记录不存在返回 404。
- `PATCH /api/v1/admin/datasets/:file_hash` `{note}` → 编辑数据集备注。
- `GET /api/v1/admin/tokens`（不返回完整令牌）/ `POST /api/v1/admin/tokens` `{name}`（返回一次性完整令牌）/ `DELETE /api/v1/admin/tokens/:id`（吊销）。

变更（客户端，需有效未吊销令牌）：

- `GET /api/v1/datasets`、`GET /api/v1/date-notes`、`GET /api/v1/date-notes/:key` 加 Bearer 校验；失败返回 401。

## 管理页面（/admin，保持无构建原生 HTML/JS）

三个标签 + 登录视图：

- **数据集**：现有列表增加每行操作【下载】【删除】（二次确认）【备注】（行内编辑保存）【归档】（已有）；
- **密钥**：生成（填名称）→ 弹窗一次性展示完整令牌并提供复制按钮；列表显示名称/创建时间/最近使用/状态；吊销需二次确认；
- **日期备注**：保留现有功能。

登录视图：密码输入 + 提交；401 时返回登录视图；登录限锁时提示剩余时间。

## 桌面端（本次一并实施）

- `SettingsView` 云端服务器卡片增加「访问密钥」输入框，存 localStorage（`scut.remote-access-token`），与现有 `scut.remote-server-url` 同级；
- `src/api/remote.ts` 各请求携带 `Authorization: Bearer <令牌>`；云端请求失败（含未配置或令牌无效得到 401）时统一回退本地数据，并在界面提示一次「云端未授权或不可达，请检查设置中的服务器地址与访问密钥」。

## 部署

- `server/docker-compose.yml` 的 app 服务增加环境变量 `SCUT_ADMIN_PASSWORD`（用户指定；会话为随机令牌存库，无需签名密钥）。
- 重部署流程不变：scp 目录 → `docker compose up -d --build`；结构迁移启动时自动执行。
- 回滚：镜像可重建，数据库列/表为增量添加，无需回滚脚本。

## 测试

- `node --test` 增补：登录成功/失败/锁定、会话过期与登出、令牌生成一次性/校验/吊销、客户端接口 401、删除（含文件清理与缺失容忍）、下载（含穿越拒绝、404）、备注编辑。沿用 `server.test.mjs` 风格。
- 桌面端：`remote.ts` 带头逻辑与 SettingsView 密钥输入的 Vitest 用例。

## 非目标（本阶段不做）

- 域名、HTTPS、Caddy 反向代理；
- 多管理员账号体系；
- 文件版本管理、按文件的细粒度下载授权；
- 服务端文件与桌面端本地缓存的数据分发/同步协议。
