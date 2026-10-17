# SCUT Racing Telemetry

SCUT Racing Telemetry 是面向赛车数据分析的 Windows 桌面应用，用于导入、查看、对比和导出 AiM 及 CSV 遥测记录。当前版本 1.3.0。

## 主要功能

- 导入 AiM 文件（XRK、XRZ）、遥测 CSV 文件和 ZIP 压缩包。
- 使用本地缓存，重复打开记录时无需重新解析。
- 按日期、车辆、车手和场次浏览记录。
- 多通道同步曲线、时间游标和窗口缩放。
- 图表直接读取 raw 原始样本，保留真实数据间隔。
- 缺失遥测保持为空白，不会跨越缺口人为连线。
- 查看当前窗口的最小值、最大值、平均值和标准差。
- 查看 GPS 赛道轨迹并进行缩放、平移。
- 将选中的记录导出为 CSV。
- 从云端拉取缺失记录，检查并安装软件更新。
- 将记录通道绑定为 HUD 并导出带透明通道的 MOV 视频（Overlay）。
- 支持明暗主题、可调整栏宽和窗口状态保存。

## 技术栈

- Tauri 2：Windows 桌面壳和原生命令。
- Rust：导入、缓存、统计、导出、原始样本和 AiM DLL 接口。
- React 18、TypeScript、Vite 6：前端界面。
- uPlot：高性能时间序列绘图。
- Zustand：应用状态管理。
- Tailwind CSS 和 CSS 设计令牌：布局和主题。
- Vitest：前端测试。
- WebView2：Windows 界面运行时。
- 云端服务：Node.js HTTP + PostgreSQL 16，提供记录分发、共享日期备注、管理员后台与软件自动更新。
- 本地 SQLite：记录总索引、单条备注和分析偏好；无需额外安装数据库。
- FFmpeg / ffprobe：Overlay 视频编码与导出校验。

## Rust 模块

- telemetry-core：通道模型、对齐、统计、降采样和 CSV 工具。
- cache-core：持久化缓存、原始通道和窗口数据。
- aim-ffi：AiM XRK DLL 接口。
- csv-parser：CSV 遥测解析。
- telemetry-store：SQLite 连接、迁移、索引、备注与偏好。
- telemetry-ipc：Rust 与前端之间的 DTO、二进制帧协议和错误结构。
- overlay：时间线计算、通道绑定、HUD 与透明帧渲染。
- xrk-meta：云端独立使用的 XRK/XRZ 元数据解析器，不进入桌面安装包。
- Overlay 导出：src-tauri 协调渲染、FFmpeg 编码、ffprobe 校验与进度取消；输出尺寸、输出帧率、渲染采样帧率、padding 和编码器（QTRLE / ProRes 4444）均可在工作台调整。
- src-tauri：Tauri 命令和桌面入口。

## 目录结构

```text
src/                    React 界面和前端测试
src-tauri/              Tauri 命令和桌面入口
crates/                 Rust 工作区模块（8 个业务 crate）
config/                 前端构建配置与依赖边界契约
server/                 PostgreSQL schema、同步 API、管理员网页和启动脚本
resources/              FFmpeg / ffprobe（Git 忽略，打包时映射到安装目录）
Data/                   开发样例和应用资源
TestMatLabXRK/          AiM 运行时 DLL 及其依赖
tests/                  测试夹具和工具检查
.agent/                 当前维护说明与历史归档
```

## 开发环境

- Windows 10 或更高版本
- Node.js 和 pnpm 11
- Rust stable（通过 rustup 安装）
- Microsoft WebView2 Runtime
- AiM XRK DLL（仓库中的 TestMatLabXRK 目录提供开发和打包所需 DLL）
- FFmpeg 与 ffprobe（Overlay MOV 导出使用，需放在 `resources/` 才能随包分发）。程序查找顺序见下文。

```powershell
pnpm install
pnpm dev
```

### FFmpeg 查找顺序

`find_ffmpeg` 依次检查：`IMAGEIO_FFMPEG_EXE` → EXE 同目录 `ffmpeg.exe` → EXE 同目录 `resources/ffmpeg.exe` → 工作目录 `resources/` 与 `target/release/` → PATH。`ffprobe` 优先取 FFmpeg 同目录，否则退回 PATH。两者需要来自同一套构建。

### 本地数据位置

默认数据根是实际运行的 EXE 同目录下 `data/`；开发态 `cargo run` 时回退到工作区 `.cache/`。`SCUT_CACHE_ROOT` 可覆盖数据库与缓存位置。目录需要可写。

### 测试云端服务

`server` 目录包含 PostgreSQL schema、API、管理员网页和启动脚本。测试阶段可以用 Docker 启动 PostgreSQL：

```powershell
pwsh server/start-server.ps1 -StartDatabase
```

如果 PostgreSQL 已经在本机运行，也可以直接启动：

```powershell
pnpm server:start
```

服务默认地址为 `http://127.0.0.1:8787`，管理员网页位于 `/admin`。启动需要在本地 `.secrets/server.env` 或环境变量提供数据库和管理员凭据，Docker 数据库还需要 SCUT_DB_PASSWORD。配置和启动步骤见 [server README](server/README.md)。

管理员上传 XRK/XRZ 后，服务器解析元数据、保存原文件并建立索引；日期备注由管理员维护。桌面端在 Database 设置中填写 Base URL 和访问密钥，拉取缺少的记录并导入本地；本地备注和偏好不回传云端。数据同步与软件更新共用用户填写的 Base URL。

如需指定 DLL 或缓存目录：

```powershell
$env:SCUT_AIM_DLL = "C:\path\to\MatLabXRK-2022-64-ReleaseU.dll"
$env:SCUT_CACHE_ROOT = "C:\path\to\telemetry-cache"
```

## 验证

```powershell
pnpm typecheck
pnpm lint
pnpm test
cargo check --workspace
```

## 构建和发布

日常验证只构建 exe，不生成安装包：

```powershell
pnpm build:exe
```

输出位于 `target/release/scut-racing-telemetry.exe`。需要分发安装包与自动更新签名时使用 `build.ps1`，签名凭据保存在本地 `.secrets/signing/`。

```powershell
pwsh -NoProfile -File build.ps1
```

安装包输出位置：

```text
target/release/bundle/nsis/SCUT Racing Telemetry_<版本>_x64-setup.exe
target/release/bundle/nsis/SCUT Racing Telemetry_<版本>_x64-setup.exe.sig
```

安装包包含编译后的 React 前端、Rust/Tauri 后端、AiM 主 DLL 及其依赖，以及映射到 `resources/` 的 FFmpeg / ffprobe，安装后可独立完成 Overlay 视频导出。请分发 setup.exe。WebView2 使用引导安装方式，可能需要网络。

导入记录使用源文件 SHA-256 标识，默认保存在安装目录下的 data 文件夹中。也可以通过 SCUT_CACHE_ROOT 指定其他位置。缺失样本保留为非有限值，前端会显示为空白；generation 字段用于丢弃拖动和缩放期间返回的过期请求。

## 维护文档

[文档入口](.agent/README.md) · [当前架构](.agent/当前架构.md) · [发布与同步](.agent/发布与同步.md) · [目录与清理边界](.agent/工作区目录说明.md)。历史方案和完整记录集中在 [历史归档](.agent/archive/2026-10-09/README.md)。

## 项目状态

本项目用于 SCUT Racing 遥测分析。许可证和正式发布策略将在确定后补充。
