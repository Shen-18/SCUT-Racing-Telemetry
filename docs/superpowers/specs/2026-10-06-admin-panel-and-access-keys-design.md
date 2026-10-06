# 管理面板与云端数据分发设计（v2）

状态：设计已确认（2026-10-06，v2 修订），待实施。v1 的密钥「一次性展示」改为「随时可查」，并新增「云端 → 桌面端」数据分发流程与 XRK/XRZ 服务器端解析。

## 背景与目标

云端同步服务（`server/`，部署于阿里云 Ubuntu 24.04，`/opt/SCUTRacing/`，IP `8.134.196.199:8787`）现有的 `/admin` 页面只有上传索引/归档/日期备注且无鉴权。本设计将其升级为车队数据分发中心：

- **管理员是数据源头**：面板上传 `.xrk`/`.xrz` 文件（服务器自动解析生成记录）、写日期备注、下载/删除文件；
- **队员桌面端是消费端**：启动时自动检查 + 手动「检查更新」按钮，拉取云端最新索引，与本地按 `file_hash` 比对，把缺少的数据文件下载并自动导入本地数据库；
- 队员凭「链接 + 密钥」连接；管理员凭密码登录面板。

实现路线：现有原生 Node 服务上扩展（方案 A），新增一个纯 Rust 元数据提取器随镜像构建；桌面端在现有 Tauri 应用内扩展。

## 核心组件：XRK/XRZ 元数据提取器（`crates/xrk-meta`）

- 仓库内新 crate（命令行工具），**源码在仓库、随 Docker 多阶段构建编译进服务器镜像，仅运行在服务器**。
- 依赖 `aim-wifi`（纯 Rust）：XRZ 解包（`split_xrk`：zlib 流剥离）、尾帧解析（`parse_tail_frames`：VEH=车辆 / RCR=车手）。
- XRK 头部元数据（开始时间、时长、通道数等）按 RS3 项目的逆向文档移植：`D:/Desktop/RS3/XRK_METADATA_REVERSE_ENGINEERING.md`（Python 参照 `aim_capture.py`）。
- 输出 JSON：`record_date`、`start_time`、`duration`、`vehicle`、`racer`、`channel_count`、`sample_rate_hint` 等。
- 测试：以仓库 `TestMatLabXRK/`、`Data/` 真实文件为 fixtures；解析失败的字段允许缺失，由服务端兜底（见上传语义）。

## 上传与索引生成语义

- 管理页上传 `.xrk`/`.xrz`（单文件 ≤512MB）。
- 服务端流程：SHA-256 → 已存在同 hash 则返回「重复」→ 保存至 `data/uploads/<hash>.<ext>` → 调用 `xrk-meta` 提取元数据 → 写入 `datasets` 行（storage_key 关联文件）→ 返回新记录。
- 提取失败：返回 422 与原因，**不入库不留文件**（整单拒绝）；兜底字段——vehicle/racer 缺失存空串（校验允许空），`duration=0`。
- 桌面端已有的索引自动上报（bulk sync）保留：队员本地导入的文件索引也汇入云端总览。

## 安全模型（v2 修订）

| 层 | 凭证 | 保护范围 |
| --- | --- | --- |
| 管理员 | 密码 → 会话 Cookie（httpOnly，7 天），失败 5 次锁 10 分钟 | 全部 `/api/v1/admin/*`（login 除外） |
| 队员客户端 | 访问令牌（`Authorization: Bearer`） | `/api/v1/*` 客户端读接口与文件下载 |

- **令牌不再「只显示一次」**：生成后入库为可读原文，面板列表随时可查、可复制、可吊销（内部工具，接受数据库泄露即令牌泄露的代价）。
- 管理密码来自环境变量 `SCUT_ADMIN_PASSWORD`；未设置时 admin 接口返回明确错误。
- 明文 HTTP 为已知限制（可信网络使用），接口 HTTPS-ready。

## API

新增 admin（会话 Cookie 保护）：

- `POST /api/v1/admin/login` / `POST /api/v1/admin/logout`
- `POST /api/v1/admin/uploads`（现有，扩展：接受 xrk/xrz 并走解析入库流程）
- `GET /api/v1/admin/files/:storage_key` → 下载（防目录穿越，Content-Disposition 原文件名）
- `DELETE /api/v1/admin/datasets/:file_hash` → 删记录 + 删关联文件
- `GET /api/v1/admin/tokens` / `POST /api/v1/admin/tokens {name}` / `DELETE /api/v1/admin/tokens/:id`

客户端（Bearer 令牌保护）：

- `GET /api/v1/datasets`（现有，加令牌）
- `GET /api/v1/date-notes*`（现有，加令牌）
- `GET /api/v1/files/:file_hash` → 队员下载数据文件（按索引中的 storage_key 定位，流式返回）

## 管理页面（/admin，风格复刻桌面 DATABASE 页）

无构建原生 HTML/JS（admin-ui/ 拆分文件），F1 Display 字体、红顶栏、日期分组列表：

1. **登录视图**：密码输入；
2. **记录页**：按日期分组（与桌面库页一致的分组头 + 备注摘要），每行【下载】【删除】（二次确认）【归档】；页首【上传 xrk/xrz】按钮，上传后解析结果与失败原因就地展示；
3. **日期备注**：保留现有编辑能力；
4. **设置页**：密钥分发——生成（命名）→ 列表（名称/令牌全文/最近使用/吊销按钮）→ 页面顶部固定展示「链接 + 密钥」复制对（链接=当前访问地址 origin）。

## 桌面端

- 设置「云端服务器」卡片：**链接**（已有）+ **访问密钥**（新增，localStorage `scut.remote-access-token`）；
- **检查更新流程**（启动后自动一次 + 库页「检查更新」按钮）：
  1. `GET /api/v1/datasets`（带令牌）取云端索引；
  2. 与本地 `listRecords` 按 `file_hash` 求差集；
  3. 差集逐个 `GET /api/v1/files/:hash` 下载到应用数据目录的 `cloud-downloads/` 临时位置；
  4. 逐个走现有导入管线（`importFiles`，进度条复用 ImportProgressBar），完成后清理临时文件；
  5. 汇总提示「云端新增 N 个数据文件已导入」；失败逐条报告，不影响其余文件。
- 未配置链接/密钥时静默跳过；401 提示去设置填写。
- 桌面 → 云端的索引自动上报（已上线）保留不动。

## 数据模型（schema.sql 增量，启动自动迁移，幂等）

- 新表 `admin_sessions`（token_hash 主键、expires_at）。
- 新表 `client_tokens`（id SERIAL 主键、name、token 原文唯一、created_at、last_used_at、revoked_at 可空）。
- `datasets` 表已有 `storage_key` 列，上传解析入库时写入。

## 部署

- Dockerfile 改多阶段：`rust:1-alpine`（或 slim）阶段编译 `xrk-meta`（静态链接 musl）→ 拷入 `node:22-alpine` 镜像 `/app/bin/xrk-meta`；compose 不变。
- compose app 环境变量新增 `SCUT_ADMIN_PASSWORD`（用户指定）。
- 重部署流程不变：scp → `sudo bash deploy.sh`。

## 测试

- `xrk-meta`：真实 fixtures 解析（日期/时长/车辆/车手）、XRZ 与 XRK 两种输入、损坏文件容错。
- 服务端 node --test：登录/会话/锁定、令牌增删查、上传解析入库（mock 提取器）、下载穿越防护、客户端接口 401。
- 桌面端 Vitest：差集计算、下载→导入编排（mock fetch 与 importFiles）、设置页密钥字段。
- 端到端：部署后服务器 curl 冒烟 + 桌面端真连。

## 非目标（本阶段不做）

- 域名、HTTPS、Caddy；多管理员账号；按文件的细粒度授权；客户端到客户端的分发；服务器端写入桌面本地缓存结构（桌面导入始终走本地导入管线）。
