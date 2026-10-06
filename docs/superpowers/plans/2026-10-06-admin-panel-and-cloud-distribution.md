# 管理面板与云端数据分发 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/admin` 升级为带登录的车队数据分发中心：上传 `.xrk/.xrz` 自动生成记录（服务器端 Rust 解析），队员桌面端凭「链接+密钥」在启动/点按钮时拉取云端索引、比对并自动下载导入缺失文件。

**Architecture:** 新 crate `crates/xrk-meta`（依赖 `aim-wifi` 的 XRZ 解包与尾帧解析，XRK 头部元数据按 RS3 逆向文档移植）经 Docker 多阶段构建进服务端镜像；Node 服务加管理员会话与客户端令牌两层鉴权、上传解析入库、按 hash 下载、删除路由；桌面端新增 Rust 下载命令（reqwest）与「检查更新」编排（拉索引→差集→下载→走现有导入管线）。

**Tech Stack:** Rust 2021（aim-wifi、serde_json、reqwest[desktop]）、Node 22（零新依赖）、原生 HTML/JS 管理页、Vitest、node --test。

**Spec:** `docs/superpowers/specs/2026-10-06-admin-panel-and-access-keys-design.md`

## Global Constraints

- 服务端 Node 零新依赖；`reqwest` 是唯一新 Rust 依赖（仅 src-tauri），必须同步更新 `config/contracts/dependencies.json` 并让 `python tests/tooling/verify_dependencies.py` PASS。
- 上传只接受 `.xrk` / `.xrz`，单文件 ≤512MB；解析失败整单拒绝（422），不入库不留文件。
- 客户端令牌入库为可读原文（随时可查可复制）；管理密码来自环境变量 `SCUT_ADMIN_PASSWORD`，未设置时 admin 接口报明确错误。
- 提交信息用中文；**所有提交只在本地，不推送**（推送时机由负责人另行决定）。
- 不使用 git worktree（工作树含大量未提交改动，直接在其上工作；提交只 add 本任务相关文件）。
- 现状说明：`crates/aim-wifi` 已被负责人有意移出 workspace members（RS3 项目经路径依赖使用它）；**不要加回 members**，`crates/xrk-meta` 以路径依赖引用它即可（cargo 会照常编译该路径依赖）。

---

### Task 1: `crates/xrk-meta` 元数据提取器（TDD，真实 fixture 金测）

**Files:**
- Create: `crates/xrk-meta/Cargo.toml`
- Create: `crates/xrk-meta/src/lib.rs`、`crates/xrk-meta/src/main.rs`
- Modify: `Cargo.toml`（members 追加 `"crates/aim-wifi"`（若缺）与 `"crates/xrk-meta"`）
- Test: `crates/xrk-meta/tests/golden.rs`
- 参考: `D:/Desktop/RS3/XRK_METADATA_REVERSE_ENGINEERING.md`、`D:/Desktop/RS3/aim_capture.py`

**Interfaces:**
- Produces CLI：`xrk-meta <file.xrk | file.xrz>` → stdout 单行 JSON：
  `{"record_date":"YYYY-MM-DD","start_time":"HH:MM:SS","duration_seconds":<f64>,"vehicle":"...","racer":"...","channel_count":<u32>}`
  字段解析不出时输出空串/0，**不报错**；文件损坏/非 XRK 时 exit 2 并在 stderr 输出原因。
- Produces 库函数：`pub fn extract(path: &Path) -> Result<Meta, ExtractError>`；`pub struct Meta { record_date: String, start_time: String, duration_seconds: f64, vehicle: String, racer: String, channel_count: u32 }`。
- Consumes：`aim_wifi::{split_xrk, parse_tail_frames, decompress_zlib}`（Task 1 开始前确认这些导出名，以 `crates/aim-wifi/src/xrz.rs` 当前实现为准）。

- [ ] **Step 1: 追加 workspace members**

把 `Cargo.toml` 的 members 数组追加 `"crates/xrk-meta"`（**不要**加 aim-wifi，负责人已有意移出）；运行 `cargo metadata --no-deps --format-version 1 > /dev/null && echo ok` 验证 workspace 完整。

- [ ] **Step 2: 读取逆向文档，锁定解析点**

读 `D:/Desktop/RS3/XRK_METADATA_REVERSE_ENGINEERING.md` 全文和 `D:/Desktop/RS3/aim_capture.py` 中 xrk 头部/日期/时长相关函数。在 `crates/xrk-meta/src/lib.rs` 顶部注释里记下：头部偏移表、日期时间编码、时长来源、通道数来源（各 1-2 行）。

- [ ] **Step 3: 用 Python 参照生成金标准**

```bash
python D:/Desktop/RS3/aim_capture.py --help   # 确认调用方式后，对 fixture 提取元数据
```

对 `Data/AGX.xrk` 与 `Data/Du.xrk` 各生成一份期望值（日期、开始时间、时长、车辆、车手、通道数），写死进测试常量。若 Python 工具无法直接输出某字段，以 RS3 文档中的字段说明人工核对。

- [ ] **Step 4: 写失败测试**

```rust
// crates/xrk-meta/tests/golden.rs
use std::path::PathBuf;
use xrk_meta::extract;

fn fixture(name: &str) -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Data").join(name) }

#[test]
fn agx_xrk_golden() {
    let meta = extract(&fixture("AGX.xrk")).expect("parse AGX.xrk");
    assert_eq!(meta.record_date, "…金标准日期…");
    assert_eq!(meta.start_time, "…金标准…");
    assert!((meta.duration_seconds - …金标准…).abs() < 1.0);
    assert_eq!(meta.channel_count, …金标准…);
}

#[test]
fn xrz_input_matches_xrk() {
    // 用 aim_wifi 的 compress 把 AGX.xrk 打成临时 .xrz 再 extract，断言与 xrk 直读一致
}

#[test]
fn corrupt_file_fails_cleanly() {
    let p = std::env::temp_dir().join("xrk-meta-corrupt.xrk");
    std::fs::write(&p, b"not an xrk").unwrap();
    assert!(extract(&p).is_err());
}
```

运行 `cargo test -p xrk-meta`，预期编译失败（crate 未实现）。

- [ ] **Step 5: 实现最小实现**

`src/lib.rs`：按 Step 2 的偏移表实现 `extract()`——XRZ 先 `split_xrk` 取 xrk 体与尾帧，尾帧 `parse_tail_frames` 取 VEH/RCR；XRK 体头部按文档取日期/时长/通道数。`src/main.rs`：参数处理 → `extract` → `serde_json::to_string` 打印，错误 exit 2。依赖：`aim-wifi`、`serde`、`serde_json`。

- [ ] **Step 6: 测试通过 + clippy**

`cargo test -p xrk-meta` 全过；`cargo clippy -p xrk-meta --all-targets -- -D warnings` 零警告；`cargo fmt`。

- [ ] **Step 7: 提交（仅本地）**

```bash
git add Cargo.toml Cargo.lock crates/xrk-meta
git commit -m "feat: xrk-meta 元数据提取器（XRK/XRZ → JSON）"
```

### Task 2: 服务端会话与令牌数据层 + schema

**Files:**
- Modify: `server/schema.sql`（追加两表）
- Modify: `server/db.mjs`（会话/令牌 CRUD）

**Interfaces:**
- Produces db 方法（供 Task 3/4 路由使用）：
  `createAdminSession(tokenHash, expiresAtUnix)`、`getAdminSession(tokenHash)` → `{token_hash, expires_at} | null`、`deleteAdminSession(tokenHash)`、`purgeExpiredAdminSessions(now)`
  `createClientToken({name, token})` → 行、`listClientTokens()` → 行数组、`revokeClientToken(id)`、`getClientToken(token)` → 行|null（revoked_at 为空才算有效）、`touchClientToken(id)`
  `getDatasetByHash(fileHash)` → 行|null、`deleteDataset(fileHash)` → 被删行|null
- 表：`admin_sessions(token_hash TEXT PRIMARY KEY, expires_at BIGINT)`；`client_tokens(id SERIAL PRIMARY KEY, name TEXT NOT NULL, token TEXT NOT NULL UNIQUE, created_at BIGINT, last_used_at BIGINT NULL, revoked_at BIGINT NULL)`。

- [ ] **Step 1: schema.sql 追加两张表（CREATE TABLE IF NOT EXISTS，幂等）**
- [ ] **Step 2: db.mjs 实现上述方法（与现有 saveDateNote 同风格，参数化 SQL）**
- [ ] **Step 3: `node --check server/db.mjs` 与 `node --test server/server.test.mjs` 通过（现有 5 项不回归）**
- [ ] **Step 4: 提交（仅本地）`git commit -m "feat: 服务端会话与令牌数据层"`（add server/schema.sql server/db.mjs）**

### Task 3: 鉴权与令牌路由（fake-db 路由测试）

**Files:**
- Create: `server/auth.mjs`
- Modify: `server/local-server.mjs`（`createApp(db, deps = {})` 第二参注入 `{adminPassword, now}`；新增路由与两个守卫）
- Test: `server/server.test.mjs`（新增 fake-db + `createApp` + `fetch` 的路由级用例）

**Interfaces:**
- Cookie 名 `scut_admin_session`，HttpOnly、SameSite=Lax、Max-Age 604800；会话令牌 = 32 字节随机 base64url，库存 `sha256(token)`。
- `requireAdmin(request, db)`：读 Cookie → `getAdminSession` → 未过期放行；失败 401 `{"error":{"code":"unauthorized"}}`。
- `requireToken(request, db)`：`Authorization: Bearer <token>` → `getClientToken` → 有效则 `touchClientToken` 并放行；失败 401。
- 登录限锁：内存 `Map<ip, {fails, until}>`，5 次失败锁 600s，锁定期返回 429。
- 路由：`POST /api/v1/admin/login`、`POST /api/v1/admin/logout`、`GET/POST /api/v1/admin/tokens`、`DELETE /api/v1/admin/tokens/:id`；`GET /api/v1/datasets`、`GET /api/v1/date-notes*` 加 `requireToken`。
- `SCUT_ADMIN_PASSWORD` 未设置时：login 恒 503 `{"error":{"code":"admin_password_not_set"}}`，其余 admin 路由同样 503。

- [ ] **Step 1: 写失败测试**——用内存 fake-db（Map 实现上面接口）+ `createApp(fakeDb, { adminPassword: "test-pw" })` + `server.listen(0)` + fetch，覆盖：登录成功设 Cookie/失败 401、5 次锁定 429、带 Cookie 访问 admin、无 Cookie 401、登出后失效、令牌创建/列表含原文/吊销后 401、客户端接口无令牌 401。
- [ ] **Step 2: 运行确认失败** `node --test server/server.test.mjs`
- [ ] **Step 3: 实现 auth.mjs 与路由**（零新依赖：`node:crypto` randomBytes/sha256；`SCUT_ADMIN_PASSWORD` 经 `createApp` 参数或 resolveServerConfig 注入）
- [ ] **Step 4: 测试全过；`node --test server/server.test.mjs`；提交（仅本地）`feat: 管理员会话与客户端令牌路由`**

### Task 4: 上传解析入库 + 下载 + 删除

**Files:**
- Modify: `server/local-server.mjs`、`server/storage.mjs`（保存后返回路径）
- Test: `server/server.test.mjs`（stub 提取器经 deps 注入）

**Interfaces:**
- `createApp(db, deps)` 增 `deps.runExtractor(filePath) → Promise<Meta JSON 对象>`；生产默认实现 `execFile("xrk-meta", [path])`（PATH 上找；容器内 `/app/bin`）。测试传 stub。
- `POST /api/v1/admin/uploads`（扩展）：multipart 或原始字节流（沿用现有 `x-file-name` 头方案）→ 扩展名 ∈ {xrk, xrz} 且 ≤512MB，否则 415/413 → sha256 → `getDatasetByHash` 命中返回 200 `{ok, duplicate: true}` → 存 `data/uploads/<hash>.<ext>` → `runExtractor` → `db` 写入 datasets 行（storage_key、vehicle/racer/duration/日期时间来自 Meta，缺失字段按 spec 兜底空串/0）→ 201 `{ok, file_hash}`。提取 throw → 删除已存文件 + 422。
- `GET /api/v1/admin/files/:storage_key`：校验 `storage_key` 形如 `[0-9a-f]{64}\.\w+`（防穿越）→ 流式返回 `data/uploads/<key>`，`Content-Disposition` 用 `x-file-name` 查询参数或原文件名；404。
- `DELETE /api/v1/admin/datasets/:file_hash`：删行（含 storage_key 文件 unlink，缺文件容忍）→ `{ok}`；404。
- `GET /api/v1/files/:file_hash`（令牌）：按 hash 找 dataset → 按 storage_key 流式返回；无 storage_key 404。

- [ ] **Step 1: 写失败测试**（stub 提取器返回固定 Meta；覆盖：成功入库含 storage_key、重复上传 duplicate、解析失败 422 且文件被清理、非 xrk/xrz 415、管理员下载、客户端按 hash 下载、删除后下载 404）
- [ ] **Step 2: 确认失败 → Step 3: 实现 → Step 4: 测试全过**
- [ ] **Step 5: 提交（仅本地）`feat: 上传解析入库与文件下载/删除`**

### Task 5: 管理页 UI v2（admin-ui/）

**Files:**
- Rewrite: `server/admin-ui/index.html`、`server/admin-ui/admin.js`、`server/admin-ui/admin.css`

**Interfaces（页面结构）：**
- 登录视图：密码框 + 登录；401/429 显示原因。
- 主视图三标签：**记录**（按 `record_date` 分组，组头含日期备注摘要；行内 文件名/车辆/车手/时长 + 【下载】【删除(确认)】【归档】；页首【上传 xrk/xrz】`<input type=file>`，结果与失败原因就地显示）；**日期备注**（沿用现有逻辑）；**设置**（顶部「链接+密钥」复制对：链接=当前 origin，密钥下拉选择已建令牌；令牌列表：名称/全文等宽显示/最近使用/吊销；新建令牌表单）。
- 鉴权行为：任何请求 401 → 切回登录视图；登出按钮。
- 风格：F1 Display 字体标题、红顶栏、细边框卡片（对齐桌面端观感；不引任何外部资源，字体走系统回退）。

- [ ] **Step 1: 实现 index.html/admin.css/admin.js（原生 fetch，无构建）**
- [ ] **Step 2: 手动清单**——本地起 fake？无本地 PG：直接在 Task 8 部署后按「验证清单」逐项手测；本任务完成标准 = 代码就绪 + `node --check server/admin-ui/admin.js` 通过。
- [ ] **Step 3: 提交（仅本地）`feat: 管理面板 UI v2`**

### Task 6: Dockerfile 多阶段 + compose 管理密码

**Files:**
- Modify: `server/Dockerfile`、`server/docker-compose.yml`

**Interfaces:**
- Dockerfile：
  ```dockerfile
  FROM rust:1-alpine AS extractor
  WORKDIR /build
  COPY xrk-meta-worker ./   # 见下方说明：仅复制 xrk-meta 与 aim-wifi 源码 + 顶层 Cargo.toml
  RUN cd xrk-meta && cargo build --release && strip /build/target/release/xrk-meta
  ```
  说明：构建上下文是 server/，拿不到 crates/；**改为**由 deploy.sh 在服务器上先 `cargo build --release -p xrk-meta`（服务器已装 Rust？没有——因此 deploy.sh 增加「若服务器无 cargo，则在 app/ 下预编译产物随 scp 上传」两分支）。**采用更简单方案**：本机（已有 Rust 工具链）预编译 `xrk-meta` 二进制，`scp` 时随 `server/bin/xrk-meta` 上传（Linux x86_64 产物用 `cargo build --release --target x86_64-unknown-linux-gnu` 交叉编译或在服务器上编译一次后回存）；Dockerfile 仅 `COPY bin/xrk-meta /app/bin/xrk-meta`。deploy.sh 加一步：若 `server/bin/xrk-meta` 缺失且服务器有 cargo，则现场编译。
- compose：app 服务环境变量加 `SCUT_ADMIN_PASSWORD: ${SCUT_ADMIN_PASSWORD:-}`，值放 `/opt/SCUTRacing/app/.env`（不入 git）。
- `.dockerignore` 加 `bin/`（避免镜像层重复）→ 改为**不加**，bin/ 必须进构建上下文。

- [ ] **Step 1: 本机交叉编译产物入 `server/bin/`（`.gitignore` 加 `server/bin/`）** `rustup target add x86_64-unknown-linux-gnu && cargo build --release -p xrk-meta --target x86_64-unknown-linux-gnu && cp target/x86_64-unknown-linux-gnu/release/xrk-meta server/bin/`
  （交叉编译若因系统库失败，备选：直接在服务器上 `cargo build`，deploy.sh 分支已覆盖）
- [ ] **Step 2: Dockerfile 加 COPY bin/xrk-meta /app/bin/xrk-meta 与 ENV PATH**
- [ ] **Step 3: 提交（仅本地）`feat: 服务端镜像携带 xrk-meta 与管理密码配置`**

### Task 7: 桌面端下载命令 + 依赖契约

**Files:**
- Modify: `src-tauri/Cargo.toml`（reqwest json/no-rustls-tls 按现有 TLS 情况定）、`src-tauri/src/state.rs`（`pub fn data_root(&self) -> PathBuf` = `self.cache.path()`）、`src-tauri/src/main.rs`（注册命令）、Create: `src-tauri/src/cloud.rs`
- Modify: `config/contracts/dependencies.json`（加 reqwest 条目）

**Interfaces:**
- Tauri 命令：`cloud_download_file(url: String, token: String, file_hash: String, ext: String) -> Result<String, CmdError>`
  行为：`GET {url}/api/v1/files/{file_hash}`，头 `Authorization: Bearer <token>`；保存到 `<data_root>/cloud-downloads/<file_hash>.<ext>`；非 200 → 报错带状态码；成功返回保存路径。大小上限 512MB。
- 复用 `crate::state::{command_error, CommandResult}` 模式；`CREATE_NO_WINDOW` 不适用（无子进程）。

- [ ] **Step 1: 加依赖 + 更新依赖契约，`python tests/tooling/verify_dependencies.py` PASS**
- [ ] **Step 2: 实现 cloud.rs（reqwest blocking 即可，命令内 `tauri::async_runtime::spawn_blocking` 或直接 blocking 命令——与现有命令风格一致）**
- [ ] **Step 3: `cargo clippy -p scut-racing-telemetry --all-targets -- -D warnings` 零警告；`cargo test -p scut-racing-telemetry` 不回归**
- [ ] **Step 4: 提交（仅本地）`feat: 桌面端云端文件下载命令`**

### Task 8: 桌面端「检查更新」编排 + 设置密钥

**Files:**
- Modify: `src/api/remote.ts`（`listRemoteDatasets(baseUrl, token)`）、`src/api/client.ts`（`downloadCloudFile` 包装）、`src/components/SettingsView.tsx`（密钥输入框）、`src/components/LibraryView.tsx`（按钮 + 启动检查）、`src/state/appStore.ts`（如需状态）
- Create: `src/api/cloudUpdate.ts`
- Test: `src/api/cloudUpdate.test.ts`

**Interfaces:**
- `computeMissing(cloud: RemoteDatasetIndex[], local: RecordSummary[]): RemoteDatasetIndex[]`——按 file_hash 差集。
- `runCloudUpdate(deps: { baseUrl, token, local, listRemote, download, importFiles, onNotice? })`：拉索引 → 差集 → 逐个 download → `importFiles([path])` → 汇总 `{fetched, failed: [{file_name, message}]}`；任一失败继续其余。
- 设置键：`scut.remote-access-token`；未配置时静默跳过；401 提示一次。
- 库页按钮：`data-testid="check-updates"`，文案「检查更新」；启动检查：挂载后 3 秒触发一次（配置齐全才执行，静默失败）。

- [ ] **Step 1: 写 cloudUpdate.test.ts（差集用例 + 编排成功/部分失败/401 用例，mock deps）→ 确认失败**
- [ ] **Step 2: 实现 cloudUpdate.ts + 接线（remote.ts/client.ts/SettingsView/LibraryView）**
- [ ] **Step 3: `pnpm test`（161+新增全过）、`pnpm typecheck`、`pnpm lint` 干净**
- [ ] **Step 4: 提交（仅本地）`feat: 桌面端检查更新与访问密钥`**

### Task 9: 部署联调 + 端到端冒烟

**Files:**
- Modify: `.agent/交接文档-2026-10-06-云端服务与索引同步.md`（追加 v2 部署与验证结果）、`.agent/工作进度.md`（补 10-06 条目）

- [ ] **Step 1: 生成强管理密码写入服务器 `.env`（`SCUT_ADMIN_PASSWORD=<ADMIN_PASSWORD>
- [ ] **Step 2: curl 冒烟（服务器本机）**：login → 上传 `Data/AGX.xrk` → 记录列表出现解析出的行（日期/车辆来自真实文件）→ 建令牌 → 带 Bearer `GET /api/v1/datasets` → `GET /api/v1/files/<hash>` 下载与原文件 sha256 一致 → DELETE → 下载 404。
- [ ] **Step 3: 桌面端（可选，耗时）**：`pnpm build:exe` 后真机验证「检查更新」全链路；或先以 curl 级验证为准，桌面构建交负责人。
- [ ] **Step 4: 更新交接文档与工作进度；提交（仅本地）`docs: 管理面板与云端分发联调记录`**
- [ ] **Step 5: 验证清单（负责人手测）**：浏览器登录 /admin → 上传 → 记录出现 → 复制「链接+密钥」→ 桌面端填写 → 检查更新 → 新文件出现在本地数据库页。

---

## Self-Review 记录

- 覆盖检查：spec 的提取器（T1）、上传语义（T4）、安全模型（T2/T3）、API（T3/T4）、管理页（T5）、桌面端（T7/T8）、部署（T6/T9）均有对应任务；「桌面端 401 提示一次」在 T8 Step 2 接线中实现。
- 类型一致性：`Meta` 字段名（T1）与 Task 4 服务端消费一致；`RemoteDatasetIndex` 沿用已上线定义；`createApp(db, deps)` 注入贯穿 T3/T4。
- 已知风险：XRK 头部解析字段若与 RS3 文档有出入，以「能拿到多少用多少、缺失走兜底」原则降级，不阻塞主流程（T1 Step 5 兜底 = spec 上传语义）。
