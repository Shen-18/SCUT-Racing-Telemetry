# SCUT Racing Telemetry

SCUT Racing Telemetry 是面向赛车数据分析的 Windows 桌面应用，用于导入、查看、对比和导出 AiM 及 CSV 遥测记录。

## 主要功能

- 导入 AiM 文件（XRK、XRZ）和遥测 CSV 文件。
- 使用本地缓存，重复打开记录时无需重新解析。
- 按日期、车辆、车手和场次浏览记录。
- 多通道同步曲线、时间游标和窗口缩放。
- 图表直接读取 raw 原始样本，保留真实数据间隔。
- 缺失遥测保持为空白，不会跨越缺口人为连线。
- 查看当前窗口的最小值、最大值、平均值和标准差。
- 查看 GPS 赛道轨迹并进行缩放、平移。
- 将选中的记录导出为 CSV。
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
- 同步服务：Node.js HTTP 服务 + PostgreSQL，用于模拟云端索引、日期备注和管理员后台。

## Rust 模块

- telemetry-core：通道模型、对齐、统计、降采样和 CSV 工具。
- cache-core：持久化缓存、原始通道和窗口数据。
- aim-ffi：AiM XRK DLL 接口。
- csv-parser：CSV 遥测解析。
- telemetry-ipc：Rust 与前端之间的二进制帧协议。
- Overlay：从 Database 记录选择数据，绑定遥测通道并导出带透明通道的 MOV；输出尺寸、输出帧率、渲染采样帧率、padding 和编码器均可在工作台调整。
- src-tauri：Tauri 命令和桌面入口。

## 目录结构

```text
src/                    React 界面和前端测试
src-tauri/              Tauri 命令和桌面入口
crates/                 Rust 工作区模块
config/frontend/        Vite、TypeScript、ESLint 配置
server/                 PostgreSQL schema、同步 API、管理员网页和启动脚本
Data/                   开发样例和应用资源
TestMatLabXRK/          AiM 运行时 DLL 及其依赖
tests/                  测试夹具和工具检查
```

## 开发环境

- Windows 10 或更高版本
- Node.js 和 pnpm 11
- Rust stable（通过 rustup 安装）
- Microsoft WebView2 Runtime
- AiM XRK DLL（仓库中的 TestMatLabXRK 目录提供开发和打包所需 DLL）
- FFmpeg 与 ffprobe（Overlay MOV 导出使用）。程序会依次查找 `IMAGEIO_FFMPEG_EXE`、程序目录、`resources` 目录和 PATH；FFmpeg 与 ffprobe 需要来自同一套构建。

```powershell
pnpm install
pnpm dev
```

### 测试云端服务

`server` 目录包含 PostgreSQL schema、API、管理员网页和启动脚本。测试阶段可以用 Docker 启动 PostgreSQL：

```powershell
pwsh server/start-server.ps1 -StartDatabase
```

如果 PostgreSQL 已经在本机运行，也可以直接启动：

```powershell
pnpm server:start
```

服务默认地址为 `http://127.0.0.1:8787`，数据库连接串默认是 `postgresql://scut:<DATABASE_PASSWORD>@127.0.0.1:5432/scut_telemetry`，也可以通过 `SCUT_DATABASE_URL` 覆盖。打开 Database 设置，填入该地址并点击“测试连接”即可验证桌面端与服务端的连接。

管理员页面位于 `http://127.0.0.1:8787/admin`，可登记或更新数据集索引、归档数据集、维护日期备注。当前页面只保存元信息，原始遥测文件的对象存储上传将在正式服务器阶段接入。普通桌面端只读取数据和日期备注，不提供管理员写入入口。

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

输出位于 `target/release/scut-racing-telemetry.exe`。只有需要分发安装包时才运行 `pnpm tauri build`。

```powershell
pnpm tauri build
```

安装包输出位置：

```text
target/release/bundle/nsis/SCUT Racing Telemetry_1.0.0_x64-setup.exe
```

安装包包含编译后的 React 前端、Rust/Tauri 后端、AiM 主 DLL 及其依赖。请分发 setup.exe，不要只复制单独的 exe；安装器会释放运行所需的原生 DLL，并处理 WebView2 安装。

导入记录使用源文件 SHA-256 标识，默认保存在安装目录下的 data 文件夹中。也可以通过 SCUT_CACHE_ROOT 指定其他位置。缺失样本保留为非有限值，前端会显示为空白；generation 字段用于丢弃拖动和缩放期间返回的过期请求。

## 项目状态

本项目用于 SCUT Racing 遥测分析。许可证和正式发布策略将在确定后补充。
