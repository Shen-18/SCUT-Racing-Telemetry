# SCUT Racing Telemetry — 技术细节文档

本文档深入说明 SCUT Racing Telemetry 的内部实现细节，涵盖数据模型、解析器架构、DLL 桥接、数据处理流水线、分析引擎、UI 架构、主题系统和打包策略。

---

## 目录

1. [数据模型层](#1-数据模型层)
2. [解析器子系统](#2-解析器子系统)
3. [DLL 桥接架构](#3-dll-桥接架构)
4. [数据处理流水线](#4-数据处理流水线)
5. [分析引擎](#5-分析引擎)
6. [资料库管理系统](#6-资料库管理系统)
7. [配置系统](#7-配置系统)
8. [UI 架构](#8-ui-架构)
9. [主题系统](#9-主题系统)
10. [打包策略](#10-打包策略)

---

## 1. 数据模型层

所有模块共享的核心数据类型定义在 `models.py` 中。

### `ChannelMeta` — 通道元数据

```python
@dataclass(frozen=True)
class ChannelMeta:
    key: str        # 内部唯一键名（处理重名列）
    name: str       # 原始显示名称
    unit: str       # 单位字符串
    source: str     # "csv" | "xrk" | "xrk:gps" | "derived"
    dtype: str      # "time" | "numeric" | "flag" | "text"
```

`label` 属性自动拼接 `name [unit]` 格式用于显示。

### `SessionMeta` — 会话元数据

记录会话的元信息：文件路径、类型、车手、车辆、日期时间、采样率、持续时间和圈信息。圈信息 `LapInfo` 记录圈序号、开始时间和持续时间。

### `TelemetryDataset` — 核心数据集

```python
@dataclass
class TelemetryDataset:
    id: str                      # UUID
    meta: SessionMeta            # 会话元数据
    channels: dict[str, ChannelMeta]  # key → ChannelMeta
    frame: pd.DataFrame          # 数据矩阵，Time 列为基准
    header_order: list[str]      # 列顺序
    raw_metadata: list[tuple]    # 原始元数据键值对
```

- `name` 属性返回友好的显示名称（`"文件名 - 车手名"`）
- `time` 属性返回 `frame["Time"]` 的 numpy 数组
- `max_time` 属性返回最大时间值
- `numeric_channels()` 返回所有可绘制的数值通道列表

### `TimeWindow` — 时间窗口

不可变值对象，确保 `start ≤ end` 且 `≥ 0`。`clamped()` 方法将窗口约束在合法范围内。

---

## 2. 解析器子系统

解析器定义在 `parser.py` 中，提供统一的 `load_telemetry()` 入口点。

### 2.1 统一入口

```python
def load_telemetry(path, *, fallback_csv=True) -> TelemetryDataset
```

- `.csv` 后缀 → `parse_csv(path)`
- `.xrk` / `.xrz` 后缀 → `parse_xrk(path)`（从 `xrk_dll.py` 导入）
- 当 XRK 解析失败且 `fallback_csv=True` 时，自动尝试同名的 `.csv` 文件

### 2.2 CSV 解析器

`parse_csv()` 完整的解析流程：

**步骤 1：编码检测**
依次尝试 UTF-8 BOM、UTF-8、GB18030、CP1252，确保中文元数据正确解码。

**步骤 2：分隔符探测**
使用 `csv.Sniffer` 嗅探分隔符，回退依次尝试逗号、分号、制表符。选择能成功找到 `Time` 表头行的分隔符。

**步骤 3：表头定位**
扫描所有行，查找第一列内容为 `"Time"` 且列数 ≥ 3 的行，将其识别为表头行。表头的下一行是单位行，再之后是数据行。

**步骤 4：键名去重**
RaceStudio3 可能导出同名列（如多个 "Speed"）。`_make_unique_keys()` 通过添加 `(2)`、`(3)` 后缀确保键名唯一。

**步骤 5：元数据提取**
表头行之前的所有非空行视为元数据键值对，提取 Session、Vehicle、Racer、Date、Sample Rate、Duration、Segment Times 等。

**步骤 6：数值解析**
`_to_float()` 处理多种数值格式：空字符串 → NaN、欧洲十进制逗号（`,` → `.`）、科学记数法、以及通用的非数字字符清理。

**步骤 7：时间归一化**
`normalize_frame_time()` 将所有时间值减去最小值，确保 Time ≥ 0。

**步骤 8：圈数解析**
`_laps_from_metadata()` 解析 `Segment Times` 字段，支持 `m:ss.fff` 格式的分段时间。

**步骤 9：通道类型推断**
`infer_channel_dtype()` 的逻辑：
- 名称为 `"Time"` → `"time"`
- 数值占比 < 95% → `"text"`
- 单位为 `#` 或名称含 flag/state/error 等关键词 → `"flag"`
- 否则 → `"numeric"`

### 2.3 CSV 导出

`export_racestudio_like_csv()` 将 `TelemetryDataset` 导出为 RaceStudio3 兼容格式：
- 元数据区（键值对格式）
- 空行分隔
- 表头行（原始通道名）
- 单位行
- 空行
- 数据行（指定格式：Time 列 `.3f`，整数列 `.0f`，GPS 坐标 `.8f`，默认 `.4f`）

---

## 3. DLL 桥接架构

`xrk_dll.py` 实现了通过 `ctypes` 调用 AiM 官方 C++ DLL 的完整桥接。

### 3.1 设计目标

使用 AiM 官方提供的解析 DLL，**而不是**逆向工程 `.xrk` 文件格式。优势：
- 100% 兼容所有 AiM 固件版本
- 避免复杂的二进制解析逻辑
- 自动获得官方对新型号的支持

### 3.2 DLL 加载与依赖管理

```python
class XrkDll:
    def __init__(self, dll_path):
        # 设置 DLL 搜索路径（父目录和 64/ 子目录）
        # 通过 CDLL 加载主 DLL
        # 绑定所有函数签名
```

**依赖 C++ 运行时**：DLL 需要 MSVC 9.0 运行时（`msvcr90.dll`），通过 `WinSxS` 定位。

**依赖 C 库**：`libxml2-2.dll`、`libiconv-2.dll`、`libz.dll`、`pthreadVC2_x64.dll`，位于 `TestMatLabXRK/64/`。

**Windows DLL 搜索路径**：使用 `os.add_dll_directory()`（Python 3.8+，Windows）将 DLL 目录添加到搜索路径。

### 3.3 ctypes 函数绑定

所有 DLL 函数的参数类型和返回值类型明确声明：

| DLL 函数 | 用途 | C 签名 |
|---------|------|--------|
| `open_file` | 打开 XRK 文件 | `int open_file(const char*)` |
| `close_file_i` | 关闭文件 | `int close_file_i(int)` |
| `get_vehicle_name` | 获取车辆名 | `char* get_vehicle_name(int)` |
| `get_racer_name` | 获取车手名 | `char* get_racer_name(int)` |
| `get_championship_name` | 获取锦标赛名 | `char* get_championship_name(int)` |
| `get_session_type_name` | 获取赛道名 | `char* get_session_type_name(int)` |
| `get_date_and_time` | 获取日期时间 | `struct tm* get_date_and_time(int)` |
| `get_laps_count` | 获取圈数 | `int get_laps_count(int)` |
| `get_lap_info` | 获取圈信息 | `int get_lap_info(int, int, double*, double*)` |
| `get_session_duration` | 获取会话时长 | `int get_session_duration(int, double*)` |
| `get_channels_count` | 标准通道数 | `int get_channels_count(int)` |
| `get_channel_name` | 通道名 | `char* get_channel_name(int, int)` |
| `get_channel_units` | 通道单位 | `char* get_channel_units(int, int)` |
| `get_channel_samples_count` | 采样点数 | `int get_channel_samples_count(int, int)` |
| `get_channel_samples` | 采样数据 | `int get_channel_samples(int, int, double*, double*, int)` |

标准通道和 GPS 通道使用两组独立的函数族（`get_channels_*` vs `get_GPS_channels_*`），通过 `_bind_channel_family()` 统一绑定。

### 3.4 XRK 解析流程

`parse_xrk()` 的完整流程：

1. **定位并加载 DLL**：`find_default_dll()` 在 5 个候选路径中查找，覆盖开发环境和 PyInstaller 打包环境
2. **打开文件**：`dll.open(path)` 获取会话索引
3. **获取时长**：优先使用 `get_session_duration()`，回退到圈信息计算
4. **构建时间轴**：以 20 Hz 采样率创建均匀时间轴 `timeline = arange(0, duration, 1/20)`
5. **读取通道**：
   - GPS 通道：过滤出预定义的 14 个 GPS 通道（`GPS_CHANNELS`），从原始时间戳重采样
   - 标准通道：读取所有通道，直接从原始时间戳重采样
6. **单位转换**：`convert_channel_units()` 处理已知的转换规则（m/s → km/h, cm → mm）
7. **衍生通道**：从 `GPS Speed` 计算 `Distance on GPS Speed`（累积积分）
8. **构建 Dataset**：与 CSV 解析器输出相同的 `TelemetryDataset` 结构

### 3.5 重采样策略

`resample_values()` 将每个通道的原始时间戳数据映射到统一时间轴：

```
原始采样（不规则时间戳）：
  t1    t2    t3    t4         t5    t6
  │     │     │     │          │     │
  v1    v2    v3    v4         v5    v6

统一时间轴（20 Hz 均匀）：
  ─┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──
  0  0.05 0.10 0.15 0.20 ... 59.95 60.00
```

实现：对原始数据排序 → 去重 → `numpy.interp()` 线性插值。单点数据则填充常数。

### 3.6 GPS 时间戳处理

GPS 通道的时间戳单位可能是毫秒（值 > 1000），在重采样前自动转换为秒：
```python
if source == "gps" and np.nanmax(time_arr) > 1000.0:
    time_arr = time_arr / 1000.0
```

---

## 4. 数据处理流水线

`processor.py` 中的函数构成数据处理流水线。

### 4.1 `visible_frame()`

核心函数，为 UI 层提供数据切片：

```python
def visible_frame(dataset, window=None, offset=0.0) -> pd.DataFrame:
```

处理步骤：
1. 复制原始 `DataFrame`
2. 创建 `AlignedTime` 列（`Time + offset`）
3. 过滤 `AlignedTime < 0` 的行（时间轴不显示负数）
4. 如果指定了 `TimeWindow`，裁剪到该窗口范围
5. 重置索引返回

### 4.2 `clamp_window()`

确保用户无法将时间窗口拖动到负值区域或超出数据范围。

### 4.3 `sample_at()`

在任意时间点获取通道值，用于十字线追踪：
- 使用 `numpy.searchsorted()` 二分查找
- 选择最近邻采样点
- 处理 NaN 和越界

### 4.4 `export_selected_csv()`

导出选定数据：
- 单文件模式：导出 AlignedTime + 选中通道
- 双文件模式：导出 A 的时间轴 + A 的数据 + 插值对齐的 B 的数据
- B 数据插值使用 `numpy.interp()` 以 A 的时间轴为基准

---

## 5. 分析引擎

`analyzer.py` 实现统计分析和双文件对比。

### 5.1 通道统计

`summarize_channel()` 计算：
- `min`：最小值
- `max`：最大值
- `avg`：算术平均值
- `std`：总体标准差（`ddof=0`）
- `count`：非 NaN 样本数

使用 `pd.to_numeric(..., errors="coerce")` 确保非数值数据被忽略。

### 5.2 双文件对比

`compare_channel()` 计算方法：
1. 应用时间窗口和 B 文件偏移
2. 将 B 数据插值到 A 的时间轴
3. 计算：
   - **RMSE**：均方根误差
   - **MAE**：平均绝对误差
   - **Corr**：皮尔逊相关系数（至少需要 3 个不同值）
   - **Max Abs Error**：最大绝对误差

### 5.3 自动偏移估算

`estimate_offset()` 实现了基于互相关（cross-correlation）的自动对齐算法：

1. **数据准备**：确定有效重叠时间范围，以 50ms（`step = 0.05`）为间隔重采样
2. **去均值**：从两个序列中减去各自的均值，消除直流偏置
3. **互相关**：`numpy.correlate(av, bv, mode="full")` 计算完整互相关序列
4. **搜索范围**：限制在 `±max_shift_seconds` 范围内（默认 10 秒）
5. **峰值检测**：寻找最大相关值对应的滞后量
6. **结果**：返回最佳偏移时间（秒），正值表示 B 需要向右偏移

```
互相关原理示意：
A:  ────\__/───┬───\__/────────
B:  ────────\__/───┬───\__/────
                   ↑
            最佳对齐点
            B 偏移 +Δt
```

---

## 6. 资料库管理系统

`library.py` 实现基于 SQLite 的本地数据库。

### 6.1 数据库架构

表结构：
- `runs`：跑动记录（id, file_hash, original_name, original_path, stored_path, file_type, imported_at, run_datetime, duration, driver, vehicle, note_title, note_body）
- `date_notes`：日期备注（date_label, note_title, note_body）

### 6.2 文件存储

- 文件以 SHA-256 哈希值重命名存储，路径为 `files/{hash[:2]}/{hash}.{ext}`
- 自动去重：相同内容的文件只存储一次
- 保留原始文件名和路径作为元数据

### 6.3 导入流程

`import_paths()` 支持多种输入源：
- 单个 `.xrk` / `.csv` 文件
- 文件夹（可选择递归扫描）
- `.zip` 压缩包（自动枚举内部支持的遥测文件）

导入步骤：
1. 计算文件 SHA-256 哈希
2. 检查数据库是否已存在相同哈希
3. 调用 `load_telemetry()` 解析文件
4. 复制文件到 `files/` 目录
5. 插入数据库记录
6. 支持进度回调函数

### 6.4 ZIP 批量导出

`export_records_zip()` 将选中的跑动记录导出为 ZIP 压缩包：
- 每条记录导出为 RaceStudio3 格式 CSV
- 文件名格式：`{时间}_{原始文件名}.csv`
- 可选包含备注信息
- 自动处理同名文件冲突

### 6.5 备注解析

`note_from_comment()` 智能解析元数据 Comment 字段中的备注信息：
- 支持中文/英文标签：`备注标题`/`标题`/`Title`、`备注内容`/`内容`/`Body`
- 使用正则表达式提取结构化备注
- 标题限长 80 字符

---

## 7. 配置系统

`settings.py` 实现双层配置架构。

### 7.1 配置层级

```
setting.md（主要人工编辑格式）
    ↓ 解析
AppSettings（内存中的配置对象）
    ↑ 回退
settings.json（JSON 后备格式）
```

### 7.2 setting.md 格式

使用 INI 风格的标记格式：
```ini
## 系统
default_theme = dark
display_preset = medium

## 文件
library_root = ./library

## 布局
main_window_width = 1500
main_window_height = 920
```

### 7.3 显示预设

三种预设（small / medium / large）控制 UI 比例：

| 参数 | small | medium | large |
|------|-------|--------|-------|
| 基础字号 | 12px | 13px | 15px |
| 标题字号 | 16px | 17px | 20px |
| 列表项高 | 22px | 25px | 32px |
| 通道字号 | 11px | 12px | 14px |

用户可在 `setting.md` 中对三个预设的每个属性单独微调。

---

## 8. UI 架构

`ui/main_window.py` 是应用程序的图形界面，基于 PySide6 (Qt6) 构建。

### 8.1 主窗口结构

```
MainWindow (QMainWindow)
├── Top Bar（顶部导航栏）
│   ├── 应用标题 + 图标
│   ├── 导航按钮：主页 / 分析 / 设置
│   └── 主题切换开关
├── QStackedWidget（页面容器）
│   ├── [0] LibraryPage（主页 - 资料库）
│   ├── [1] AnalysisPage（分析页）
│   └── [2] SettingsPage（设置页）
└── Status Bar（状态栏）
```

### 8.2 主页（LibraryPage）

```
LibraryPage
├── 左侧：操作面板
│   ├── 导入按钮（文件 / 文件夹 / 压缩包）
│   ├── 搜索框
│   ├── 分组选择（无分组 / 日期 / 车手 / 车辆）
│   ├── 跑动记录列表（QTreeWidget）
│   │   └── 每条记录：时间、车手、车辆、时长
│   └── 选中记录操作
│       ├── 打开分析
│       ├── 导出 ZIP
│       ├── 查看/编辑备注
│       └── 删除
└── 右侧：信息面板
    ├── 选中记录的元数据和备注
    ├── 日期备注编辑器
    └── 入库文件统计
```

### 8.3 分析页（AnalysisPage）

```
AnalysisPage
├── 工具栏
│   ├── 文件 A 选择
│   ├── 文件 B 选择（启用双文件模式）
│   ├── 对比模式切换（叠图 / 分图）
│   ├── 时间偏移滑块（双文件模式）
│   ├── 自动对齐按钮
│   └── 导出按钮（PNG / CSV）
├── QSplitter（三栏可调布局）
│   ├── [左] 通道列表面板
│   │   ├── 文件 A 通道列表（QCheckBox）
│   │   └── 文件 B 通道列表（仅双文件叠图模式）
│   ├── [中] 图表面板
│   │   ├── 主图表区（pg.GraphicsLayoutWidget）
│   │   │   ├── 多个 PlotItem（垂直堆叠）
│   │   │   ├── 十字线（InfiniteLine）
│   │   │   └── Tooltip 标签
│   │   └── 总览时间轴（ViewBox，底部）
│   │       └── 时间选区控件（LinearRegionItem）
│   └── [右] 统计面板
│       ├── 游标位置显示（时间 + 各通道值）
│       ├── 通道统计表（min / max / avg / std）
│       └── 双文件对比指标（RMSE / Corr / MAE）
└── 时间偏移栏（双文件模式，可折叠）
```

### 8.4 图表系统

基于 pyqtgraph 构建：

**PlotItem 堆叠**：
每个选中的通道在一个独立的 PlotRow 中渲染，垂直堆叠。每行包含：
- 左侧：通道名 + 单位标签
- 中心：PlotItem（折线图）
- 共享 X 轴（Time）

**十字线系统（Cursor）**：
```python
# 垂直 InfiniteLine 作为游标线
cursor_line = InfiniteLine(pos=0, angle=90, movable=True)

# 鼠标事件
mouse_click → cursor_line.setPos(x)  # 单击定位
mouse_drag  → cursor_line.setPos(x)  # 拖动连续更新
mouse_move  → 更新 tooltip + 统计面板
```

**时间范围选择**：
- 底部总览轴（Overview ViewBox）显示完整数据
- `LinearRegionItem` 作为选区控件，拖拽选区控制主图表可见范围
- 选区边缘可独立拖动，整体可平移
- 选区永不超出数据范围（Time ≥ 0）

**Y 轴自动缩放**：
每次数据更新时，调用 `plot.autoRange()` 自动适配 Y 轴范围，用户不可手动缩放 Y 轴。这是设计约束—确保曲线始终以最佳比例显示。

### 8.5 双文件对比模式

**叠图模式（Overlay）**：
- 同一个 PlotItem 中绘制 A 和 B 两条曲线
- 曲线颜色区分（A 为主线色，B 为橙色/虚线）
- 通道列表显示两个文件的通道复选框

**分图模式（Split）**：
- A 和 B 分别绘制在上下两个 PlotItem 中
- 共享 X 轴缩放/平移
- 独立的 Y 轴自动缩放

### 8.6 设置页（SettingsPage）

```
SettingsPage
├── 主题选择（深色 / 浅色）
├── 显示预设（小 / 中 / 大）
├── 打开 setting.md 配置
├── 缓存管理（清除 / 重建）
└── 关于信息
```

---

## 9. 主题系统

`ui/theme.py` 实现完整的深色/浅色主题系统。

### 9.1 主题定义

`Theme` 数据类定义了 13 个颜色属性：
- `background`：窗口背景
- `panel`：面板背景
- `panel_hover`：面板悬停
- `border`：边框
- `text`：文字颜色
- `text_muted`：次要文字
- `accent`：强调色
- `grid`：网格线
- `plot_background`：图表背景
- `warning` / `green` / `red`：语义色

### 9.2 主题应用

`apply_theme()` 执行三个步骤：
1. 设置 `QPalette`：窗口、按钮、文字、高亮等颜色
2. 设置全局 `QSS` 样式表：所有控件的精确样式
3. 设置 `pyqtgraph` 颜色：`setConfigOptions(background, foreground)`

### 9.3 QSS 样式表

`qss()` 函数生成约 240 行的样式表，覆盖所有 UI 组件：
- 面板（圆角 8px，阴影）
- 导航按钮
- 列表、树形、表格控件
- 复选框、滑动条
- 分割器
- 滚动区域

使用 `DisplayProfile` 中的字号和行高参数动态生成样式值。

### 9.4 色彩方案

| 用途 | 浅色主题 | 深色主题 |
|------|---------|---------|
| 背景 | `#F7F8FA` | `#0F1115` |
| 面板 | `#FFFFFF` | `#171A21` |
| 边框 | `#E5E7EB` | `#2A2F3A` |
| 文字 | `#111827` | `#F4F4F5` |
| 强调色 | `#5E6AD2` | `#8B93FF` |

---

## 10. 打包策略

### 10.1 构建脚本

`build.ps1` 是完整的 PowerShell 构建脚本：

**前置处理**：
1. 备份 `dist/SCUTRacingTelemetry/library/` 目录（如果存在）
2. 防止每次构建清空用户导入的遥测数据

**PyInstaller 执行**：
使用 `--windowed` 标志（无控制台窗口），核心参数：
```powershell
--noconfirm --clean
--name SCUTRacingTelemetry
--windowed
--icon ../Data/SCUTRacing.ico
--collect-submodules pyqtgraph
--add-data ../Data/SCUTRacing.ico;Data
--add-binary ../TestMatLabXRK/DLL-2022/*.dll;TestMatLabXRK/DLL-2022
--add-binary ../TestMatLabXRK/64/*.dll;TestMatLabXRK/64
```

**后置处理**：
1. 恢复 `library/` 目录
2. 复制 `setting.md` 和 `settings.json`
3. 复制 `RELEASE_README.md` 作为发布版的 `README.md`

### 10.2 DLL 嵌入

AiM 解析 DLL 及其所有依赖通过 `--add-binary` 嵌入到发布版的 `_internal/TestMatLabXRK/` 目录。代码通过 `find_default_dll()` 查找 DLL，覆盖开发环境和 PyInstaller 的 `sys.frozen` / `sys._MEIPASS` 路径。

### 10.3 PyInstaller 配置

`.spec` 文件使用 `COLLECT` 模式（one-directory）而不是单文件模式，原因：
- 减小启动时间（无需解压到临时目录）
- 便于用户编辑 `setting.md` 等外部配置
- 便于替换 DLL 版本
- 便于调试

### 10.4 发布目录结构

```
SCUTRacingTelemetry/
├── SCUTRacingTelemetry.exe       # 主可执行文件
├── _internal/                    # Python 运行时和依赖
│   ├── python313.dll
│   ├── PySide6/
│   ├── numpy/ / pandas/ / pyqtgraph/
│   ├── TestMatLabXRK/
│   │   ├── DLL-2022/MatLabXRK-*-ReleaseU.dll
│   │   └── 64/*.dll
│   └── Data/SCUTRacing.ico
├── library/                      # 遥测文件数据库（运行时生成）
├── setting.md                    # 用户可编辑配置
├── settings.json                 # JSON 后备配置
└── README.md                     # 发布版说明
```

---

## 关键依赖关系

```
scut_telemetry/
  │
  ├── models.py           ← 无依赖（仅 Python 标准库）
  ├── parser.py           → models.py（依赖 TelemetryDataset）
  ├── xrk_dll.py          → models.py, parser.py（依赖 infer_channel_dtype）
  ├── processor.py        → models.py
  ├── analyzer.py         → models.py, processor.py
  ├── library.py          → parser.py, settings.py（依赖 load_telemetry、default_library_root）
  ├── settings.py         ← 无内部依赖
  ├── app.py              → parser.py, ui/main_window.py
  ├── ui/theme.py         → settings.py
  └── ui/main_window.py   → analyzer.py, library.py, models.py, parser.py, processor.py, settings.py, ui/theme.py
```

---

## 性能考虑

- 20 Hz 采样率 × 典型 60 分钟 session = 72,000 行数据
- 每个通道的 pyqtgraph 曲线绘制在毫秒级完成
- 十字线更新使用最近邻插值，不重新查询 DataFrame
- DLL 调用仅在文件加载时发生，不阻塞 UI 渲染
- 自动偏移计算使用下采样互相关，通常在秒级完成
