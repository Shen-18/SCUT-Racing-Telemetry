# SCUT Racing Telemetry

**SCUT Racing Telemetry** 是一款专为大学生方程式赛车队及 AiM 数据记录仪用户设计的 **Windows 桌面遥测数据分析工具**。

它可以读取 AiM 赛道数据记录仪生成的 `.xrk` / `.xrz` 文件以及 RaceStudio3 导出的 `.csv` 文件，提供交互式图表分析、双文件对比和数据导出功能。

---

## 快速导航

| 文档 | 说明 |
|------|------|
| **[源码详细文档](code/README.md)** | 功能特性、技术栈、数据流图、模块职责、开发环境配置、打包说明 |
| **[技术细节](code/docs/TECHNICAL_DETAILS.md)** | 架构深究、DLL 桥接原理、解析器实现、分析引擎算法、UI 组件树、打包策略 |
| **[发布版使用手册](code/RELEASE_README.md)** | 面向终端用户的详细操作方法（build 时自动打包到 exe 目录） |

---

## 核心功能

- **文件解析**：支持 AiM `.xrk` / `.xrz` 二进制文件和 RaceStudio3 `.csv` 文件
- **单文件分析**：勾选数据通道，实时渲染多通道折线图
- **十字线追踪**：鼠标单击/拖动定位，显示时间与各通道值
- **时间范围选择**：底部总览轴拖拽选择分析区间
- **双文件对比**：叠图/分图两种模式，支持手动和自动时间对齐
- **统计分析**：min / max / avg / std / RMSE / 相关系数
- **资料库管理**：基于 SQLite 的本地遥测文件管理
- **数据导出**：图表 PNG、选定数据 CSV、完整数据 CSV
- **深色/浅色主题**，三种显示预设

---

## 快速开始

```powershell
# 1. 安装依赖
cd code
python -m pip install -r requirements.txt

# 2. 运行
python -m scut_telemetry

# 3. 或者用启动脚本
.\run_app.ps1
```

### 打包发布版

```powershell
cd code
.\build.ps1
```

输出路径：`code/dist/SCUTRacingTelemetry/`

---

## 技术栈

| 领域 | 技术 |
|------|------|
| 桌面 UI | PySide6 (Qt6) |
| 图表绘制 | pyqtgraph |
| 数值计算 | NumPy + Pandas |
| 二进制解析 | ctypes （调用官方 AiM C++ DLL） |
| 资料库 | SQLite3 |
| 打包 | PyInstaller |

---

## 项目结构

```
SCUTRacing/
├── code/
│   ├── scut_telemetry/          # Python 源码主包
│   │   ├── ui/                  # Qt 界面层
│   │   ├── parser.py            # CSV/XRK 解析器
│   │   ├── xrk_dll.py           # DLL ctypes 桥接
│   │   ├── processor.py         # 数据处理
│   │   ├── analyzer.py          # 统计分析引擎
│   │   ├── library.py           # 资料库管理
│   │   ├── models.py            # 数据模型
│   │   └── settings.py          # 配置系统
│   ├── scripts/                 # CLI 工具
│   ├── docs/                    # 技术文档
│   ├── README.md                # 源码详细文档
│   ├── RELEASE_README.md        # 发布版使用手册模板
│   ├── requirements.txt
│   ├── run_app.ps1 / build.ps1
│   └── setting.md / settings.json
├── Data/                        # 示例遥测数据
│   └── SCUTRacing.ico           # 应用图标
├── TestMatLabXRK/               # AiM 官方解析 DLL
│   ├── DLL-2022/                # MatLabXRK DLL
│   └── 64/                      # 运行时依赖
├── Prompt.md                    # 原始需求文档
└── LICENSE                      # MIT License
```

---

## 许可证

[MIT](LICENSE)
