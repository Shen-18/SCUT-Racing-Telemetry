# SCUT Racing Telemetry

SCUT Racing Telemetry 是面向赛车数据分析的 Windows 桌面应用，用于导入、查看、对比和导出 AiM 及 CSV 遥测记录。

## 主要功能

- 导入 AiM 文件（XRK、XRZ）和遥测 CSV 文件。
- 使用本地缓存，重复打开记录时无需重新解析。
- 按日期、车辆、车手和场次浏览记录。
- 多通道同步曲线、时间游标和窗口缩放。
- 拖动窗口时先显示金字塔预览，停顿后加载原始样本。
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

## Rust 模块

- telemetry-core：通道模型、对齐、统计、降采样和 CSV 工具。
- cache-core：持久化缓存、原始通道和窗口数据。
- aim-ffi：AiM XRK DLL 接口。
- csv-parser：CSV 遥测解析。
- telemetry-ipc：Rust 与前端之间的二进制帧协议。
- cover-video：封面视频渲染支持。
- src-tauri：Tauri 命令和桌面入口。

## 目录结构

```text
src/                    React 界面和前端测试
src-tauri/              Tauri 命令和桌面入口
crates/                 Rust 工作区模块
config/frontend/        Vite、TypeScript、ESLint 配置
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

```powershell
pnpm install
pnpm dev
```

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

```powershell
pnpm tauri build
```

安装包输出位置：

```text
target/release/bundle/nsis/SCUT Racing Telemetry_1.0.0_x64-setup.exe
```

安装包包含编译后的 React 前端、Rust/Tauri 后端、AiM 主 DLL 及其依赖。请分发 setup.exe，不要只复制单独的 exe；安装器会释放运行所需的原生 DLL，并处理 WebView2 安装。

导入记录使用源文件 SHA-256 标识，并保存到用户应用数据目录。缺失样本保留为非有限值，前端会显示为空白；generation 字段用于丢弃拖动和缩放期间返回的过期请求。

## 项目状态

本项目用于 SCUT Racing 遥测分析。许可证和正式发布策略将在确定后补充。
