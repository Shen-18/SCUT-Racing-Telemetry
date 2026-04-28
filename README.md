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

## XRK 文件解析方案

本项目的核心挑战之一是解析 AiM 数据记录仪生成的 `.xrk` / `.xrz` 二进制遥测文件。AiM 官方并未公开其文件格式规范，这给开发者带来了不小的障碍。

### 常见方案及其局限

| 方案 | 问题 |
|------|------|
| 逆向工程文件格式 | 工作量大，易随固件更新失效，精度无法保证 |
| 用 RaceStudio3 导出 CSV 再处理 | 额外步骤，无法自动化批量处理 |
| 使用 AimNexus API | 需要 .NET 环境，跨语言调用复杂，文档稀少 |

### 本项目的方案：ctypes + 官方 DLL

我们采用了另一种思路：**直接通过 Python 的 `ctypes` 加载 AiM 官方提供的解析 DLL（`MatLabXRK-2022-64-ReleaseU.dll`）来读取 XRK 文件**。

核心实现在 [`code/scut_telemetry/xrk_dll.py`](code/scut_telemetry/xrk_dll.py) 中：

```python
# 加载 AiM 官方 DLL
dll = ctypes.CDLL("MatLabXRK-2022-64-ReleaseU.dll")

# 通过 DLL API 打开文件、枚举通道、读取数据
dll.open_file(path)           # 打开 XRK 文件
dll.get_channels_count(idx)   # 获取通道数量
dll.get_channel_name(idx, i)  # 获取通道名称
dll.get_channel_samples(...)  # 读取采样数据
```

**这种方案的优势：**

- **100% 精度**：使用 AiM 自身的解析代码，数据与 RaceStudio3 完全一致
- **无需逆向**：不需要逆向二进制格式，不依赖未公开的文档
- **固件兼容**：官方 DLL 会跟随新固件更新，自动支持新型号
- **自动化**：可在 Python 中直接调用，无缝集成到数据分析流水线

### 关键代码结构

`XrkDll` 类封装了所有 DLL 交互细节：

1. **DLL 加载**：自动定位 DLL 及其依赖（`libxml2-2.dll`、`libiconv-2.dll` 等），处理 DLL 搜索路径
2. **函数绑定**：使用 `ctypes` 声明 DLL 导出函数的参数和返回值类型
3. **数据读取**：枚举标准通道和 GPS 通道，从原始时间戳重采样到 20 Hz 统一时间轴
4. **单位转换**：自动处理单位换算（m/s → km/h、cm → mm 等）
5. **衍生计算**：基于 GPS 速度计算行驶距离

详细实现见：[技术细节文档 — DLL 桥接架构](code/docs/TECHNICAL_DETAILS.md#3-dll-桥接架构)

### 给其他开发者的参考

如果你也需要在 Python 中解析 AiM XRK 文件，可以参考以下要点：

- AiM 的解析 DLL 通常位于 RaceStudio3 安装目录或 SDK 中，文件名为 `MatLabXRK*.dll`
- DLL 依赖 MSVC 运行时和 `libxml2`、`libiconv` 等 C 库
- 使用 `ctypes.CDLL` 加载，通过 `os.add_dll_directory()` 设置搜索路径
- 标准通道和 GPS 通道使用两组独立的 API 函数族
- 原始采样是不规则时间戳，需要重采样到均匀时间轴

本项目中的 `TestMatLabXRK/` 目录包含了我们使用的 DLL 版本及其所有依赖，可以作为起点直接使用。

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
