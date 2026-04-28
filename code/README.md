# SCUT Racing Telemetry

**SCUT Racing Telemetry** 是一款专为大学生方程式赛车队及其他使用 AiM 数据记录仪的用户设计的 Windows 桌面遥测数据分析工具。它能够读取 AiM 赛道数据记录仪生成的 `.xrk` / `.xrz` 二进制文件以及 RaceStudio3 导出的 `.csv` 文件，提供丰富的交互式图表分析、双文件对比和数据导出功能。

该项目由华南理工大学（SCUT）赛车队开发，用于赛车性能调校、驾驶技术分析和车辆动力学研究。

---

## 功能特性

### 文件解析
- 支持 AiM 原生 `.xrk` / `.xrz` 二进制遥测文件
- 支持 RaceStudio3 导出的 `.csv` 文件
- 自动识别数据通道名称、单位和类型
- 自动将时间轴归零对齐（Time ≥ 0）
- 采样率 20 Hz，自动检测 CSV 采样率

### 单文件分析
- 左侧列出所有数据通道（名称 + 单位），支持勾选
- 右侧渲染多通道并行折线图（Time 为 X 轴）
- **鼠标十字线追踪**：单击/拖动放置游标，实时显示时间与各通道值
- **时间范围选择**：底部总览时间轴拖拽选择区间
- Y 轴自动缩放，确保曲线占满图表区域
- 统计面板：显示每个选中通道的 min / max / avg / std

### 双文件对比
- **叠图对比（Overlay）**：两个文件的同通道曲线绘制在同一图表中
- **分图对比（Split）**：两个文件的同通道曲线分别绘制在上下两个图表中
- **手动时间偏移**：滑块拖拽调整 B 文件时间偏移，实时预览
- **自动对齐**：基于互相关（cross-correlation）算法自动估算最佳偏移量
- 对比指标：RMSE、MAE、相关系数、最大绝对误差

### 数据导出
- 图表导出为 PNG 格式
- 选定通道 + 时间窗口导出为 CSV
- 完整数据导出为 RaceStudio3 兼容格式的 CSV
- 资料库跑动记录批量导出为 ZIP（内含 CSV）

### 资料库管理
- 基于 SQLite 的本地遥测文件数据库
- 支持单文件 / 文件夹 / ZIP 导入
- 基于 SHA-256 文件哈希自动去重
- 按日期、车手、车辆分组展示
- 支持为跑动记录添加备注
- 支持为日期添加备注

### 用户体验
- **Linear 风格**现代 UI 设计
- **深色 / 浅色主题**一键切换
- 小 / 中 / 大三档显示预设
- 所有设置通过 `setting.md` 外部编辑，无需改代码

---

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                     UI 层 (PySide6)                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │                   MainWindow                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │ │
│  │  │ Library  │  │ Analysis  │  │    Settings      │ │ │
│  │  │   Page   │  │   Page   │  │     Page         │ │ │
│  │  └──────────┘  └──────────┘  └──────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │           pyqtgraph 图表引擎                        │ │
│  │   PlotWidget / PlotCurveItem / InfiniteLine        │ │
│  └────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Theme 系统 (QSS + QPalette)            │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   数据处理层 (Python)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Parser   │  │Processor │  │ Analyzer │  │ Library │ │
│  │ 解析器   │  │ 处理器   │  │ 分析引擎 │  │ 数据库  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ XrkDll   │  │ Settings │  │  Models  │             │
│  │ DLL 桥接 │  │  配置系统 │  │  数据模型 │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   外部依赖                               │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │ MatLabXRK DLL    │  │   numpy / pandas             │ │
│  │ (官方 AiM DLL)   │  │   数值计算引擎               │ │
│  └──────────────────┘  └──────────────────────────────┘ │
│  ┌──────────────────┐  ┌──────────────────────────────┐ │
│  │ SQLite3          │  │   PyInstaller (打包)         │ │
│  └──────────────────┘  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 数据流

```
.xrk / .xrz 文件
      │
      ▼
┌──────────────────┐
│  XrkDll (ctypes) │──► DLL 打开文件 → 枚举通道 → 读取采样
└──────────────────┘     → 重采样到 20Hz → 单位转换
      │
      ▼
.csv 文件 ──► Parser ──► CSV 嗅探解码 → 元数据提取 → 数值解析
      │
      ▼
┌──────────────────┐
│ TelemetryDataset  │──► 统一内存表示 (DataFrame + ChannelMeta)
└──────────────────┘
      │
      ├──► Processor ──► 时间窗口裁剪 / 数据对齐 / CSV 导出
      │
      ├──► Analyzer  ──► 统计计算 / 通道对比 / 偏移估算
      │
      └──► UI ─────────► pyqtgraph 渲染 / 用户交互
```

---

## 模块职责

### `models.py` — 数据模型
定义核心数据结构：`TelemetryDataset`（遥测数据集）、`ChannelMeta`（通道元数据）、`SessionMeta`（会话元数据）、`LapInfo`（圈信息）、`TimeWindow`（时间窗口）。所有模块共享这些模型。

### `parser.py` — 文件解析器
- `load_telemetry(path)` — 统一入口，根据后缀自动选择解析方式
- `parse_csv(path)` — 完整的 CSV 解析器：
  - 自动检测分隔符（逗号 / 分号 / 制表符）
  - 定位 RaceStudio3 格式的表头行
  - 提取所有元数据（Session、Vehicle、Racer、Date 等）
  - 构建归一化的 `DataFrame`，时间从 0 开始
  - 推断通道类型（time / numeric / flag / text）
- `export_racestudio_like_csv()` — 将数据导出为 RaceStudio3 兼容格式

### `xrk_dll.py` — DLL 桥接层
- `XrkDll` 类封装了通过 `ctypes` 调用 AiM DLL 的全部细节
- `parse_xrk()` — 完整的 XRK 解析流程：
  1. 加载 DLL 及其依赖（`os.add_dll_directory`）
  2. 打开文件获取会话句柄
  3. 读取会话元数据（车手、车辆、赛道、时间等）
  4. 枚举所有标准通道和 GPS 衍生通道
  5. 将每个通道的原始时间戳数据重采样到统一的 20 Hz 时间轴
  6. 执行单位转换（如 m/s → km/h、cm → mm）
  7. 计算衍生通道 `Distance on GPS Speed`
  8. 构建 `TelemetryDataset`
- `find_default_dll()` — 在多个候选路径中定位 DLL（支持 PyInstaller 打包环境）

### `processor.py` — 数据处理
- `visible_frame()` — 应用时间窗口裁剪和时间偏移
- `clamp_window()` — 确保时间窗口不超出合法范围
- `sample_at()` — 在指定时间点插值采样
- `export_selected_csv()` — 导出选中通道+时间窗口的数据，支持双文件合并

### `analyzer.py` — 分析引擎
- `summarize_channel()` — 通道统计（min / max / avg / std / count）
- `compare_channel()` — 双文件通道对比（RMSE / MAE / 相关系数 / 最大绝对误差）
- `estimate_offset()` — 基于互相关（cross-correlation）自动估算偏移量：
  1. 在有效时间范围内对齐采样
  2. 去均值后计算互相关序列
  3. 在指定搜索范围内寻找最大相关峰
  4. 返回最佳偏移时间（秒）

### `library.py` — 资料库管理
- `TelemetryLibrary` 类封装了基于 SQLite 的本地文件数据库
- 支持文件导入（自动去重）、删除、备注、ZIP 批量导出
- 使用 SHA-256 文件哈希作为唯一标识
- 支持从 ZIP 压缩包直接导入

### `settings.py` — 配置系统
- 双层配置：`setting.md`（人工可编辑文本格式）+ `settings.json`（JSON 后备）
- `AppSettings` / `DisplayProfile` 数据类管理所有可配置项
- 显示预设（small / medium / large）覆盖字体大小、行高、间距
- 运行时热加载配置

### `ui/theme.py` — 主题系统
- `LIGHT` / `DARK` 两个预定义主题数据类
- `apply_theme()` — 应用 QPalette + 全局 QSS 样式表
- 所有颜色、尺寸集中定义，易于扩展

### `ui/main_window.py` — 主界面
完整的 PySide6 界面实现，约 2750+ 行，包含：
- **主页（LibraryPage）**：文件导入、资料库浏览、跑动记录管理
- **分析页（AnalysisPage）**：通道选择、图表渲染、双文件对比、统计面板
- **设置页（SettingsPage）**：主题切换、显示预设、配置编辑
- **多页导航**：通过 QStackedWidget 切换页面

---

## 技术选型

| 领域 | 技术 | 选择理由 |
|------|------|----------|
| 桌面 UI | PySide6 (Qt6) | 成熟的 Windows 桌面框架，原生控件体验，完善的打包支持 |
| 图表绘制 | pyqtgraph | 针对密集时间序列数据优化，支持快速交互、游标、多轴同步 |
| 数值计算 | NumPy | 高效的数组运算、插值、统计分析 |
| 数据处理 | Pandas | DataFrame 便于表格操作、CSV 导入导出 |
| 数据库 | SQLite3 (Python 内置) | 零配置，单文件数据库，适合本地资料库 |
| 二进制解析 | ctypes | 直接调用官方 C++ DLL，避免逆向工程文件格式 |
| 打包发布 | PyInstaller | 将 Python 应用打包为独立 Windows 可执行文件 |
| 构建脚本 | PowerShell | 完善的 Windows 原生脚本支持 |

---

## 文件格式策略

### CSV 文件
CSV 文件直接在 Python 中解析。加载器执行以下操作：
1. 尝试多种编码（UTF-8 BOM、UTF-8、GB18030、CP1252）
2. 使用 `csv.Sniffer` 自动检测分隔符（逗号、分号、制表符）
3. 查找 `Time` 列标识的表头行
4. 提取表头上方的所有元数据键值对
5. 解析数值数据，处理欧洲十进制逗号格式
6. 时间归一化：将所有时间减去最小值（Time ≥ 0）
7. 推断通道数据类型
8. 构建 `TelemetryDataset` 对象

### XRK / XRZ 文件
XRK 和 XRZ 文件通过官方 AiM DLL 解析。应用程序**没有**实现自定义二进制解析器：
1. 使用 `ctypes` 加载 `MatLabXRK-2022-64-ReleaseU.dll`
2. 通过 DLL API 打开文件，获取会话句柄
3. 读取会话元数据（车辆、车手、赛道、日期、圈数等）
4. 枚举标准通道和 GPS 衍生通道
5. 将每个通道的原始采样数据重采样到 20 Hz 统一时间轴
6. 应用单位转换以匹配 RaceStudio3 输出格式
7. 计算衍生通道 `Distance on GPS Speed`
8. 构建与 CSV 解析器相同的 `TelemetryDataset` 结构

### 验证
项目提供了验证脚本 `scripts/compare_xrk_csv.py`，可将 XRK 解析结果与官方 RaceStudio3 CSV 导出进行逐通道数值比较，确保解析精度。

---

## 开发环境配置

### 前置条件
- Windows 10 或 11（仅 Windows 支持）
- Python 3.13+（推荐 3.13.x）
- PowerShell

### 安装依赖

```powershell
cd code
python -m pip install -r requirements.txt
```

### 在开发模式下运行

```powershell
cd code
.\run_app.ps1
```

或等效命令：

```powershell
cd code
python -m scut_telemetry
```

### 运行测试脚本

```powershell
# 验证 XRK 解析与官方 CSV 导出的一致性
python scripts\compare_xrk_csv.py ..\Data\AGX.xrk ..\Data\AGX.csv
python scripts\compare_xrk_csv.py ..\Data\Du.xrk ..\Data\Du.csv

# 将 XRK 转换为 RaceStudio3 格式 CSV
python scripts\xrk_to_csv.py ..\Data\AGX.xrk AGX.export.csv
```

---

## 打包发布版

```powershell
cd code
.\build.ps1
```

构建脚本执行以下操作：
1. 备份现有的 `library` 目录（如有）
2. 使用 PyInstaller 构建应用程序
3. 嵌入应用图标
4. 包含 AiM DLL 及其依赖的运行时 DLL
5. 恢复 `library` 目录
6. 复制 `setting.md`、`settings.json` 和 `RELEASE_README.md` 到发布目录

输出路径：

```
code/dist/SCUTRacingTelemetry/
```

应将**整个文件夹**作为整体分发，而不仅仅是 `.exe` 文件。

---

## 项目结构

```
SCUTRacing/
├── code/
│   ├── scut_telemetry/           # Python 主包
│   │   ├── __init__.py           # 包声明，版本号
│   │   ├── __main__.py           # 入口点
│   │   ├── app.py                # 应用引导
│   │   ├── models.py             # 数据模型
│   │   ├── parser.py             # CSV 解析器
│   │   ├── xrk_dll.py            # XRK DLL 桥接
│   │   ├── processor.py          # 数据处理
│   │   ├── analyzer.py           # 统计分析
│   │   ├── library.py            # 资料库管理
│   │   ├── settings.py           # 配置系统
│   │   └── ui/
│   │       ├── __init__.py
│   │       ├── main_window.py    # 主界面
│   │       └── theme.py          # 主题系统
│   ├── scripts/                  # CLI 工具
│   │   ├── xrk_to_csv.py         # XRK → CSV 转换
│   │   └── compare_xrk_csv.py    # 解析精度验证
│   ├── docs/
│   │   └── TECHNICAL_DETAILS.md  # 技术细节文档
│   ├── README.md                 # 本文档
│   ├── RELEASE_README.md         # 发布版 README 模板
│   ├── requirements.txt          # Python 依赖
│   ├── run_app.ps1               # 开发启动脚本
│   ├── build.ps1                 # 打包脚本
│   ├── SCUTRacingTelemetry.spec  # PyInstaller 配置
│   ├── setting.md                # 运行时设置
│   └── settings.json             # JSON 格式后备设置
├── Data/
│   ├── SCUTRacing.ico            # 应用图标
│   ├── *.xrk / *.csv             # 示例测试数据
│   └── RS3.png                   # RaceStudio3 参考截图
├── TestMatLabXRK/                # AiM 官方 DLL 及源码
│   ├── DLL-2022/
│   │   └── MatLabXRK-2022-64-ReleaseU.dll
│   ├── 64/                       # DLL 运行时依赖
│   ├── inc/                      # C++ 头文件
│   └── *.cpp, *.h, *.sln...      # C++ 测试项目源码
└── Prompt.md                     # 原始需求文档
```

---

## 许可证

本项目为华南理工大学赛车队（SCUT Racing）内部工具。
