> **2026-09-11 校订**：本文件为 Python legacy 行为参考，来源 `D:\Desktop\SCUTRacing\code\scut_telemetry\xrk_dll.py`、`models.py`、`parser.py`；新 Rust 类型与模块边界服从施工手册 rev.4.2。不将旧 DataFrame 或 UUID 强塞入 Rust API。GPS 主路径保留原始 ECEF 派生，官方插值仅作诊断。以下 Python 结构不是 Rust 接口定义。
>
> **源代码核对补充（优先于概述）**：单通道先过滤非有限时间，再取正差分中位数；接近整数判定为 rel_tol=0.005、abs_tol=0.01。文件主频只采纳 8–250Hz 合理通道，少于源码 `MIN_FILE_RATE_CHANNELS` 时返回 0，足够时以对数距离选择 20/100Hz。ECEF 使用源码八次迭代，不宣称 Bowring 闭式实现。时间数组对齐判定必须复刻源码和测试，不能只比较长度。距离积分遇到非有限/非正 dt 或非有限前值时增量为 0。旧代码把 LoggerTemp C 输出为 ?C；新界面可显示 °C，但旧版字节兼容导出必须独立保留旧格式。缺赛道名的坐标格式应以源码实现生成夹具，不将示例字符串当验收真值。时长回退 laps 后仍 ≤0 则失败并关闭句柄。VC90 CRT 是否必需由实际 DLL 加载和干净机验证，不能把文档断言当已验证依赖。
# AiM XRK 官方解析器工程实现规范 (基于原版 xrk_dll.py)

> **文档定位**：本规范**专门针对 AiM `.xrk` / `.xrz` 二进制文件的解析实现**。  
> **核心原则**：完全继承并对齐 SCUTRacing 原版 [`xrk_dll.py`](code/scut_telemetry/xrk_dll.py) 已验证稳定运行的逻辑与数据流程。新 Agent 只需依据本文档，即可用 Python 或其他语言（如 Rust / C++）完全等价地复刻 XRK 解析模块。

---

## 1. 核心设计架构与依赖库

软件不进行逆向工程，而是通过 **C ABI 动态链接（FFI / ctypes）** 加载 AiM 官方 64 位动态链接库。

### 1.1 动态库文件与依附依赖
解析依赖位于 `TestMatLabXRK/` 目录下的 64 位运行库：
* **主 DLL**：`TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll`
* **底层依赖 C 库**（位于 `TestMatLabXRK/64/`）：
  - `libxml2-2.dll`
  - `libiconv-2.dll`
  - `libz.dll`
  - `pthreadVC2_x64.dll`
* **运行时**：需要系统 MSVC 9.0 CRT（`msvcr90.dll`，通常位于 Windows WinSxS 目录）。

### 1.2 加载与搜索路径注入规约
在加载主 DLL 之前，**必须**将 DLL 所在目录及其 `../64/` 依赖目录加入 Windows DLL 搜索路径（Python 中使用 `os.add_dll_directory`，或通过 Windows API `SetDllDirectoryW`）。

---

## 2. 官方 DLL C-API 接口签名绑定

主 DLL 导出的所有函数统一采用 C 风格声明。新 Agent 需绑定以下接口：

### 2.1 文件打开与关闭
```c
// 打开文件：必须传入绝对路径，以 mbcs/utf-8 编码。
// 成功返回 session_idx (> 0)；失败返回 <= 0。
int open_file(const char* full_path_name);

// 关闭文件句柄
int close_file_i(int session_idx);

// 获取最后一次打开失败的错误文本（若存在）
const char* get_last_open_error();
```

### 2.2 基础元数据与会话属性
```c
const char* get_vehicle_name(int session_idx);       // 赛车名称
const char* get_track_name(int session_idx);         // 赛道/场地名称
const char* get_racer_name(int session_idx);         // 车手姓名
const char* get_championship_name(int session_idx);  // 赛事/车队信息
const char* get_session_type_name(int session_idx);  // 会话类型

// 获取会话时间戳：返回标准 C struct tm 指针
struct tm const* get_date_and_time(int session_idx);

// 获取总时长：成功返回 1 并写入 pduration (秒)
int get_session_duration(int session_idx, double* pduration);
```

### 2.3 圈速 (Laps) 信息
```c
// 获取总圈数
int get_laps_count(int session_idx);

// 获取单圈信息：成功返回 1，向指针写入起始时间 (秒) 与圈持续时间 (秒)
int get_lap_info(int session_idx, int lap_idx, double* pstart, double* pduration);
```

### 2.4 通道读取函数族 (标准通道与 GPS 原始通道)
AiM 将传感器数据分为两个平行的 API 家族：

| 操作 | 标准通道 (Standard Channels) | GPS 原始通道 (GPS Raw Channels) |
| :--- | :--- | :--- |
| **获取通道总数** | `int get_channels_count(int idx)` | `int get_GPS_raw_channels_count(int idx)` |
| **获取通道名称** | `const char* get_channel_name(int idx, int ch_idx)` | `const char* get_GPS_raw_channel_name(int idx, int ch_idx)` |
| **获取物理单位** | `const char* get_channel_units(int idx, int ch_idx)` | `const char* get_GPS_raw_channel_units(int idx, int ch_idx)` |
| **获取采样点数** | `int get_channel_samples_count(int idx, int ch_idx)` | `int get_GPS_raw_channel_samples_count(int idx, int ch_idx)` |
| **提取时序采样** | `int get_channel_samples(int idx, int ch_idx, double* ptimes, double* pvalues, int cnt)` | `int get_GPS_raw_channel_samples(int idx, int ch_idx, double* ptimes, double* pvalues, int cnt)` |

> **采样提取规约**：
> 1. 先通过 `*_count` 获取点数 $N$；
> 2. 分配两块连续内存：时间戳数组 `times: double[N]`，数值数组 `values: double[N]`；
> 3. 调用 `*_samples(idx, ch_idx, times, values, N)`，实际成功填充的点数为返回值 `recovered = min(ret, N)`。

---

## 3. 解析流水线与业务逻辑 (对齐原版 `parse_xrk`)

整个解析过程严格遵循原版 8 个步骤：

```
[打开文件 open_file]
       ↓
[获取时长与圈速 laps]
       ↓
[提取标准通道 standard]
       ↓
[提取 GPS 原始通道 gps_raw]
       ↓
[衍生 GPS 通道计算 derive_gps_channels]
  ├── ECEF_XYZ → 经纬度/高程 (WGS-84)
  ├── ECEF_VXYZ → 车速 GPS Speed (km/h)
  └── GPS Speed 积分 → 累计里程 Distance
       ↓
[通道去重与单位修正 (LoggerTemp 等)]
       ↓
[构建 TelemetryDataset (含 ChannelSeries 与 SessionMeta)]
       ↓
[关闭文件 close_file_i]
```

### 3.1 会话时长与圈速获取
1. 优先调用 `get_session_duration(idx, &val)`，若返回值有效且 $>0$，则以此为时长；
2. 若时长不可用，则遍历所有圈速 `laps`，以 $\max(\text{start} + \text{duration})$ 作为总时长；
3. 若总时长依然 $\le 0$，抛出异常（`XRK reported zero duration`）。

### 3.2 衍生 GPS 通道计算 (`derive_gps_channels`)
AiM 接收机输出的 `gps_raw` 包含空间直角坐标和卫星状态，原版通过以下规则派生出赛车分析所需的标准 GPS 通道：

#### 1) 经纬度与高程（由 ECEF 转大地坐标）
- 检查是否存在 `ECEF position_X`、`ECEF position_Y`、`ECEF position_Z`，且三者采样时间戳完全对齐。
- 调用标准 **WGS-84 坐标转换算法（Bowring 快速迭代法）**：
  - 椭球参数：长半轴 $a = 6378137.0\text{ m}$，扁率 $f = 1.0 / 298.257223563$，$e^2 = f(2 - f)$。
  - 输入空间坐标 $(X, Y, Z)$，迭代求出大地纬度（`GPS Latitude`，单位 `deg`）、大地经度（`GPS Longitude`，单位 `deg`）、椭球高（`GPS Altitude`，单位 `m`）。
  - 时间戳保持与 `ECEF position_X` 的时间序列一致。

#### 2) 车速（由 ECEF 空间速度分量合成）
- 检查是否存在 `ECEF velocity_X`、`ECEF velocity_Y`、`ECEF velocity_Z`（单位为 $\text{m/s}$）。
- 合成车速并转换为公里每小时：
  $$\text{Speed}_{\text{km/h}} = \sqrt{v_x^2 + v_y^2 + v_z^2} \times 3.6$$
- 生成通道名称：`GPS Speed`，单位：`km/h`。

#### 3) 卫星颗数
- 若存在 `N Satellites`，映射为友好通道名 `GPS Nsat`，单位 `#`。

#### 4) 累计里程计算 (`Distance on GPS Speed`)
- 以 `GPS Speed` 的时间戳和车速序列进行离散积分（$v$ 先换算回 $\text{m/s}$）：
  $$\Delta t_i = t_i - t_{i-1} \quad (\Delta t_i > 0)$$
  $$\Delta d_i = \Delta t_i \times v_{i-1}$$
  $$\text{Distance}_k = \sum_{i=1}^k \Delta d_i, \quad \text{Distance}_0 = 0$$
- 生成通道名称：`Distance on GPS Speed`，单位：`m`，类型为 `numeric`。

---

## 4. 细节修正与边界容错规约

### 4.1 字段命名去重 (`unique_channel_key`)
若文件中出现重复通道名（如多个同名传感器），以数字后缀区分：首个通道保持原名 `Speed`，后续重名列依次命名为 `Speed (2)`、`Speed (3)`，确保作为字典 Key 时全局唯一。

### 4.2 特殊单位与字符乱码修正
* 原始数据中如果通道名为 `LoggerTemp` 且单位为 `C`，AiM DLL 字符串解码常出现乱码 `?C`，需规范清洗为 `°C`。
* 字符串解码采用多编码回退机制：按 `UTF-8` $\to$ `MBCS` $\to$ `Latin-1` 依次尝试解码，避免因 Windows 语言包差异抛出 `UnicodeDecodeError`。

### 4.3 采样率识别与主频推断 (`infer_file_sample_rate`)
* **单通道采样率**：计算非零有限时间差分的中位数：
  $$\text{rate} = \frac{1}{\operatorname{median}(\Delta t)}$$
  若计算值与整数接近（相对误差 ≤0.005 或绝对误差 ≤0.01），则取整为标准频率（如 20Hz、50Hz、100Hz）。
* **整文件主频**：统计所有标准通道的采样率中位数，优先归类为赛车数据记录仪常用的 `20.0 Hz` 或 `100.0 Hz` 模式。

### 4.4 会话名称与 GPS 自动定位回退
* 优先读取 `get_track_name(idx)` 作为赛道名称。
* 若赛道名为空，则提取首个有效 GPS 经纬度，自动格式化为地理坐标字符串作为会话名称，例如：`23.123°N, 113.456°E`。

---

## 5. Python legacy 数据模型参考（不是 Rust 公共契约）

解析成功后，统一打包返回 `TelemetryDataset`，核心包含：

```python
# 逻辑数据载荷说明
TelemetryDataset:
  id: str                      # UUID 唯一会话标识
  meta: SessionMeta:
    file_path: Path            # 原始文件路径
    file_type: "xrk"
    session: str               # 赛道/会话名称
    vehicle: str               # 赛车名
    racer: str                 # 车手名
    championship: str          # 赛事
    date: str                  # 格式化日期 (如 "Friday, May 10, 2024")
    start_time: str            # 格式化时间 (如 "2:30 PM")
    sample_rate_hz: float      # 文件主频 (20.0 或 100.0)
    duration: float            # 会话总时长 (秒)
    laps: list[LapInfo]        # 圈信息列表 (index, start, duration)
  channels: dict[key, ChannelMeta]:
    key: str                   # 唯一标识符
    name: str                  # 显示名称
    unit: str                  # 显示单位
    source: str                # "standard" | "gps_raw" | "derived:gps_raw"
    dtype: str                 # "time" | "numeric" | "flag" | "text"
  channel_series: dict[key, ChannelSeries]:
    times: float[]             # 单通道专属时间序列 (单调递增，秒)
    values: float[]            # 单通道专属采样值
    sample_rate_hz: float      # 该通道实际采样率
```

---

## 6. 验证基准 (Verification Benchmark)

新 Agent 实现该模块后，需运行以下冒烟与数据保真度验证：
1. **基准测试文件**：调用解析 `Data/AGX.xrk` 与 `Data/Du.xrk`；
2. **正确性核对**：
   - 验证 `GPS Speed`、`Distance on GPS Speed`、`GPS Latitude`、`GPS Longitude` 是否正确成功派生；
   - 提取的车手名（Racer）、车辆名（Vehicle）、圈数（Laps）需与官方 RaceStudio3 导出的对应 `.csv` 表头元数据完全一致；
   - 同源通道采样点数须一致；f64 算法阶段与旧代码做容差对比，写入 f32 后按量级与量化误差确定各通道容差，不强制统一 1e-5。物理正确性以 RaceStudio3 CSV 为准，异步时间轴只在共同有效时间点比较，不凭空补点。



## Step 1 目录与验收修订（2026-09-11）

仓库根为 `D:/Desktop/SCUTRacingTelemetry`，目录约束统一见 `.agent/contracts/workspace-layout.md`。非根发现必需的前端配置迁至 `config/frontend/`，验收日志/报告/截图进入 `.agent/evidence/step1/`。不修改 `D:/Desktop/SCUTRacing`。产品八构件外加 `tests/golden-tests` 验证构件，因此 workspace 九成员；保留 `cargo test -p golden-tests` 标准关卡。ADR-0007 记录便携分发与 D13 证据门；Step 1 不提前实现 Step 13 打包。Python 3.11+ 仅用于依赖检查工具，不进入产品运行时。


## 目录约束最终覆盖（2026-09-11）

目录位置以 `.agent/工作区目录说明.md` 为唯一依据；若本文旧拓扑示意冲突，以该文件为准。全部项目文档在 `.agent/`，测试脚本为 `tests/tooling/`，机器白名单为 `config/contracts/dependencies.json`，前端产物为 `target/frontend/`。不再创建根 docs/scripts/dist。
