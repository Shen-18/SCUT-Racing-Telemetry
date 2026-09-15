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
    pub meta: SessionMeta,
    pub channels: Vec<ChannelMeta>,
}
