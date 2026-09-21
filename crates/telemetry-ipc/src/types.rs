use serde::{Deserialize, Serialize};
use specta::Type;
use telemetry_core::{ChannelDType, ChannelSource, SessionMeta};

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FrameHeader {
    pub channel: String,
    pub unit: String,
    pub buckets: u32,
    pub win_start: f64,
    pub win_end: f64,
    pub full_count: u64,
    pub generation: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChannelMeta {
    pub key: String,
    pub name: String,
    pub unit: String,
    pub source: ChannelSource,
    pub dtype: ChannelDType,
    pub sample_rate_hz: f32,
}
impl From<&telemetry_core::ChannelMeta> for ChannelMeta {
    fn from(c: &telemetry_core::ChannelMeta) -> Self {
        Self {
            key: c.key.clone(),
            name: c.name.clone(),
            unit: c.unit.clone(),
            source: c.source,
            dtype: c.dtype.clone(),
            sample_rate_hz: c.sample_rate_hz,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct DatasetMeta {
    pub id: u64,
    pub file_hash: String,
    /// Source file size in bytes, from the cache manifest identity.
    pub file_size: u64,
    pub meta: SessionMeta,
    pub channels: Vec<ChannelMeta>,
}

/// One library-home row: a cached dataset summarized from its manifest.
/// No DB row yet (Step 9A moves this to telemetry.db); the cache manifest
/// is the source of truth so the interface can stay stable.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct RecordSummary {
    pub file_hash: String,
    pub file_name: String,
    pub file_type: String,
    pub session: String,
    pub vehicle: String,
    pub racer: String,
    /// Recording date text as reported by the source (meta.date).
    pub record_date: String,
    pub start_time: String,
    pub duration: f64,
    pub channel_count: u64,
    pub file_size: u64,
    /// Source file mtime (unix seconds); ordering proxy until Step 9A.
    pub source_mtime_unix: u64,
    /// cache-core CacheState debug name, e.g. "Ready".
    pub cache_state: String,
}

/// 单条记录导出结果（导出四件套：单条/多选/当日共用）。
/// status: exported（已落盘）/ missing（旧版记录无库内 CSV）/ failed。
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ExportOutcome {
    pub file_hash: String,
    pub file_name: String,
    pub status: String,
    /// 落盘路径（status = exported 时有值）。
    pub path: Option<String>,
    pub message: Option<String>,
}

/// 通道窗口统计（Rust 侧全分辨率计算，spec B.4-P5）。
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChannelStatsDto {
    pub min: f32,
    pub max: f32,
    pub mean: f64,
    pub std_dev: f64,
}
