//! The single in-memory telemetry model shared by file sources and consumers.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::{collections::HashMap, path::PathBuf};

/// Persistent dataset identity assigned at the storage boundary.
pub type DatasetId = u64;

/// Provenance of a channel, independent of its presentation name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum ChannelSource {
    /// Standard recording channel.
    Standard,
    /// Official interpolated GPS channel.
    Gps,
    /// Original GPS samples.
    GpsRaw,
    /// Values derived from original GPS samples.
    DerivedGps,
    /// Other calculated values.
    DerivedCalc,
    /// CSV column.
    Csv,
}

/// Logical type; text is not silently coerced into numeric samples.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub enum ChannelDType {
    /// Time coordinate.
    Time,
    /// Numeric measurement.
    Numeric,
    /// Discrete flag.
    Flag,
    /// Textual metadata or values requiring a separate representation.
    Text,
}

/// Channel identity and units in original header order.
#[derive(Clone, Debug)]
pub struct ChannelMeta {
    /// Logical data type.
    pub dtype: ChannelDType,
    /// Unique dataset-local key; duplicate names receive a suffix.
    pub key: String,
    /// Original display name.
    pub name: String,
    /// Original physical unit.
    pub unit: String,
    /// Data provenance.
    pub source: ChannelSource,
    /// Channel-specific rate; never used to silently resample data.
    pub sample_rate_hz: f32,
}

/// Structure-of-arrays numeric samples, ordered by finite increasing time.
/// Loaders establish ordering once. Algorithms ignore an unpaired tail.
#[derive(Clone, Debug, Default)]
pub struct ChannelSeries {
    /// Sample times in seconds.
    pub times: Vec<f64>,
    /// Measurements; non-finite entries denote missing data.
    pub values: Vec<f32>,
}
impl ChannelSeries {
    /// Number of paired samples.
    /// ```
    /// use telemetry_core::ChannelSeries;
    /// let s = ChannelSeries { times: vec![0., 1.], values: vec![4.] };
    /// assert_eq!(s.len(), 1);
    /// ```
    pub fn len(&self) -> usize {
        self.times.len().min(self.values.len())
    }
    /// Whether no paired samples exist.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// One recorded lap in seconds.
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct LapInfo {
    /// Original lap index.
    pub index: u32,
    /// Start time relative to the recording.
    pub start: f64,
    /// Lap duration in seconds.
    pub duration: f64,
}

/// File-level metadata, kept separate from channel sample rates.
#[derive(Clone, Debug, Default, Serialize, Deserialize, Type)]
pub struct SessionMeta {
    /// Reference to the source file; core performs no file operations.
    pub file_path: PathBuf,
    /// File format identifier, such as xrk or csv.
    pub file_type: String,
    /// Session name.
    pub session: String,
    /// Vehicle name.
    pub vehicle: String,
    /// Driver name.
    pub racer: String,
    /// Championship name.
    pub championship: String,
    /// Recording comment.
    pub comment: String,
    /// Original date text.
    pub date: String,
    /// Original start-time text.
    pub start_time: String,
    /// File-level nominal rate.
    pub sample_rate_hz: f32,
    /// Recorded duration in seconds.
    pub duration: f64,
}

/// Shared dataset with ordered channel metadata and keyed numeric series.
#[derive(Clone, Debug, Default)]
pub struct TelemetryDataset {
    /// File/session metadata.
    pub meta: SessionMeta,
    /// Metadata in original header order.
    pub channels: Vec<ChannelMeta>,
    /// Paired numeric samples indexed by unique channel key.
    pub series: HashMap<String, ChannelSeries>,
    /// Recorded lap boundaries.
    pub laps: Vec<LapInfo>,
}
impl TelemetryDataset {
    /// Borrow a series by its unique key.
    pub fn channel(&self, key: &str) -> Option<&ChannelSeries> {
        self.series.get(key)
    }
    /// Largest paired final timestamp, or zero for an empty dataset.
    pub fn max_time(&self) -> f64 {
        self.series
            .values()
            .filter_map(|s| s.len().checked_sub(1).and_then(|i| s.times.get(i)).copied())
            .filter(|t| t.is_finite())
            .fold(0.0, f64::max)
    }
}

/// Errors exchanged by telemetry sources and pure algorithm boundaries.
#[derive(Debug, thiserror::Error)]
pub enum TelemetryError {
    /// I/O failure supplied by an external source implementation.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// Invalid data or an operation not available in this phase.
    #[error("parse: {0}")]
    Parse(String),
    /// Vendor-library failure.
    #[error("dll: {0}")]
    Dll(String),
    /// Requested entity does not exist.
    #[error("not found: {0}")]
    NotFound(String),
}

/// Source boundary reserved for file implementations and future live input.
pub trait TelemetrySource: Send + Sync {
    /// Load one dataset; file access belongs to the implementation, not core.
    fn open(&self, path: &std::path::Path) -> Result<TelemetryDataset, TelemetryError>;
}
