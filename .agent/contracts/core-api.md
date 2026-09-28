# Step 2 核心接口契约

下方代码逐字摘录施工手册 Step 2 冻结接口；施工手册是执行依据。`ChannelMeta` 为满足 `TelemetryDataset: Clone + Debug` 增加派生实现，不改变字段与签名。

```rust
pub type DatasetId = u64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
pub enum ChannelSource { Standard, Gps, GpsRaw, DerivedGps, DerivedCalc, Csv }

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub enum ChannelDType { Time, Numeric, Flag, Text }

pub struct ChannelMeta {
    pub dtype: ChannelDType,
    pub key: String,          // 唯一键；重名时 "Name (2)"
    pub name: String,         // 显示名，保留英文原样
    pub unit: String,
    pub source: ChannelSource,
    pub sample_rate_hz: f32,
}

#[derive(Clone, Debug, Default)]
pub struct ChannelSeries {
    pub times: Vec<f64>,      // 单调递增（载入时排序一次，此后只读）
    pub values: Vec<f32>,
}
impl ChannelSeries {
    pub fn len(&self) -> usize { self.times.len().min(self.values.len()) }
    pub fn is_empty(&self) -> bool { self.len() == 0 }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct LapInfo { pub index: u32, pub start: f64, pub duration: f64 }

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct SessionMeta {
    pub file_path: std::path::PathBuf,
    pub file_type: String,            // "xrk" | "csv"
    pub session: String, pub vehicle: String, pub racer: String,
    pub championship: String, pub comment: String,
    pub date: String, pub start_time: String,
    pub sample_rate_hz: f32, pub duration: f64,
}

#[derive(Clone, Debug, Default)]
pub struct TelemetryDataset {
    pub meta: SessionMeta,
    pub channels: Vec<ChannelMeta>,    // 顺序即文件 header 顺序
    pub series: std::collections::HashMap<String, ChannelSeries>,
    pub laps: Vec<LapInfo>,
}
impl TelemetryDataset {
    pub fn channel(&self, key: &str) -> Option<&ChannelSeries>;
    pub fn max_time(&self) -> f64;
}

#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    #[error("io: {0}")] Io(#[from] std::io::Error),
    #[error("parse: {0}")] Parse(String),
    #[error("dll: {0}")] Dll(String),
    #[error("not found: {0}")] NotFound(String),
}

/// D4：实时数传预留。v1.0 只有 XRK/CSV 两个文件实现。
pub trait TelemetrySource: Send + Sync {
    fn open(&self, path: &std::path::Path) -> Result<TelemetryDataset, TelemetryError>;
}

// downsample.rs（运行时备用；渲染主路径已改为预建 pyramid，此函数供统计/导出等场景）
pub struct MinMaxFrame { pub times: Vec<f64>, pub mins: Vec<f32>, pub maxs: Vec<f32> }
/// [start,end] 窗口内均分为 buckets 列，每列取 (min,max)；
/// 窗口外首尾各保留一个真实样本，保证 step 曲线边界值正确。
pub fn minmax_buckets(times: &[f64], values: &[f32], start: f64, end: f64, buckets: usize) -> MinMaxFrame;

// pyramid.rs（渲染主路径）
#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct MinMax { pub min: f32, pub max: f32 }

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct PyramidLevel {
    pub factor: u32,          // 每桶聚合的原始点数 = 2^level
    pub times: Vec<f64>,      // 每桶代表时间 = 桶内首样本时间
    pub minmax: Vec<MinMax>,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct ChannelPyramid { pub levels: Vec<PyramidLevel> }  // levels[0] 即 Level1(2x)，原始层不入塔

/// 构建：从 Level1(2x) 起逐层倍增，直到该层桶数 ≤ 512。
pub fn build_pyramid(times: &[f64], values: &[f32]) -> ChannelPyramid;

/// 查询：选"窗口内桶数 ≤ 2×pixels"的最细层；窗口比 Level1 还细时返回 None（调用方读 raw）。
pub fn query_pyramid(pyr: &ChannelPyramid, start: f64, end: f64, pixels: u32) -> Option<MinMaxFrame>;

// gps.rs
pub fn ecef_to_geodetic(x: &[f32], y: &[f32], z: &[f32]) -> (Vec<f64>, Vec<f64>, Vec<f32>); // lat,lon(deg),alt(m)
pub fn integrate_distance(times: &[f64], speed_mps: &[f32]) -> Vec<f64>;

// stats.rs
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct ChannelStats { pub min: f32, pub max: f32, pub mean: f64, pub std: f64 }
pub fn channel_stats(s: &ChannelSeries, window: (f64, f64)) -> ChannelStats;
/// 重采样到公共时间轴后的 RMSE 与 Pearson 相关系数
pub fn rmse_and_corr(a: &ChannelSeries, b: &ChannelSeries, window: (f64, f64)) -> (f64, f64);

// align.rs（Step 15 前只签名）
/// FFT 互相关估计 b 相对 a 的时间偏移（秒，正值=b 滞后）
pub fn estimate_offset(a: &ChannelSeries, b: &ChannelSeries, window: (f64, f64)) -> Result<f64, TelemetryError>;

``` 

## 行为约定与边界（Step 2）

- ChannelSeries 的有效长度为两数组的最小长度，算法忽略未配对尾部；时间轴由载入方保证有限且严格递增，纯算法不重新排序。重复时间在积分中按零增量处理。
- 数值 NaN/Infinity 视为缺失；统计跳过，min/max 桶保留有限值包络，全缺失桶返回 NaN。空统计/无共同可比较点返回 NaN；常量序列 Pearson 未定义，返回 NaN。标准差为总体标准差（除以 N）。
- 积分沿用 legacy 的左端点保持，不改成梯形积分；无效或非正时间差、非有限速度不累加。
- ECEF 使用 WGS84，极点单独处理；地心无确定大地坐标，输出 NaN。输入已量化为 f32，因此高程误差容限不得低于输入量化精度。
- RMSE/correlation 使用两时间轴交集中的采样时刻并集，加窗口截断端点，作线性插值，禁止外推和跨缺失端点插值。交换两个通道结果对称。
- minmax_buckets 使用闭窗口、按时间等宽分桶、桶代表时间取首个真实样本；额外输出窗口外紧邻前后各一个真实样本（如存在），不把它们混入内部桶。零桶/倒置或非有限窗口返回空。
- Pyramid 从 2x 开始构建，首个桶数 ≤512 的层即停止；20 点只有 10 桶一层（不因审查意见改成一直建到一桶）。多层精确测试另用 >1024 点数据；奇数尾桶和单点均保留。
- 查询二分定位：包含覆盖窗口左端的桶，不以首样本落在窗口外为由丢掉该桶。选窗口相交桶数 ≤2×pixels 的最细现存层；选层只读取索引，不扫描全层。
- raw 判定限制：冻结 ChannelPyramid 未存原始时间轴及末桶计数，无法精确计算 raw 窗口点数。用 Level1 相交桶数×2 作保守上界，若不超过 2×pixels 则返回 None。若无满足预算的存储层，也返回 None，由调用者 raw 路径处理；None 不意味着数据不存在。缓存调用方须保留运行时 min/max 备用路径，不能把 None 直接当作可无限量传输 raw 的许可。
- align 暂未实现：保留可调用签名，返回 TelemetryError::Parse 的明确延后错误，不执行 FFT、不伪造偏移量。

## 第一轮审查裁决

接受：derive 特性、文档缺失、依赖锁同步、RMSE 重采样、minmax 边界与查询 raw 回退问题。
不接受：“20 点必须构建多个层”的建议与冻结的 ≤512 停止条件矛盾；保留协议并扩充大样本多层测试。
第一轮报告中 GPS “单测通过”没有对应运行证据（当时编译失败），仅视作静态意见，需以后续实际测试日志为准。
