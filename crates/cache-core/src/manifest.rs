use crate::{CacheError, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource, LapInfo, SessionMeta};

pub const FORMAT_VERSION: u32 = 1;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceIdentity {
    pub hash: String,
    pub mtime: u64,
    pub size: u64,
}
impl SourceIdentity {
    /// Streaming SHA-256 of source bytes, not its path or timestamps.
    pub fn from_path(path: &Path) -> Result<Self> {
        let mut file = std::fs::File::open(path)?;
        let before = file.metadata()?;
        let mut digest = Sha256::new();
        let mut buffer = [0; 65536];
        let mut size = 0;
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            digest.update(&buffer[..n]);
            size += n as u64;
        }
        let after = file.metadata()?;
        if before.len() != size || before.modified()? != after.modified()? || after.len() != size {
            return Err(CacheError::Invalid("source changed while hashing".into()));
        }
        Ok(Self {
            hash: format!("{:x}", digest.finalize()),
            size,
            mtime: after
                .modified()?
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        })
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum CacheState {
    Missing,
    MetadataReady,
    RawPartial,
    RawReady,
    PyramidPartial,
    Ready,
    Failed,
    Invalid,
}
/// Serializable counterpart of core ChannelMeta (which does not implement serde).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CachedChannelMeta {
    pub dtype: ChannelDType,
    pub key: String,
    pub name: String,
    pub unit: String,
    pub source: ChannelSource,
    pub sample_rate_hz: f32,
}
impl From<ChannelMeta> for CachedChannelMeta {
    fn from(c: ChannelMeta) -> Self {
        Self {
            dtype: c.dtype,
            key: c.key,
            name: c.name,
            unit: c.unit,
            source: c.source,
            sample_rate_hz: c.sample_rate_hz,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Blob {
    pub checksum: String,
    pub bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LevelIndex {
    pub factor: u32,
    pub count: u64,
    pub offset: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PyramidIndex {
    pub blob: Blob,
    pub levels: Vec<LevelIndex>,
    pub complete: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChannelEntry {
    pub meta: CachedChannelMeta,
    pub raw: Option<Blob>,
    pub pyramid: Option<PyramidIndex>,
    pub full_count: u64,
    pub last_time: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CacheManifest {
    pub version: u32,
    pub identity: SourceIdentity,
    pub meta: SessionMeta,
    pub channels: Vec<ChannelEntry>,
    pub laps: Vec<LapInfo>,
    pub state: CacheState,
    pub error: Option<String>,
}
impl CacheManifest {
    pub(crate) fn update_state(&mut self) {
        let raw = self.channels.iter().filter(|c| c.raw.is_some()).count();
        let pyr = self
            .channels
            .iter()
            .filter(|c| c.pyramid.as_ref().is_some_and(|p| p.complete))
            .count();
        self.error = None;
        self.state = if raw == self.channels.len() && pyr == raw {
            CacheState::Ready
        } else if self.channels.iter().any(|c| c.pyramid.is_some()) {
            CacheState::PyramidPartial
        } else if raw == self.channels.len() {
            CacheState::RawReady
        } else if raw > 0 {
            CacheState::RawPartial
        } else {
            CacheState::MetadataReady
        };
    }
    pub(crate) fn validate(&self, hash: &str) -> Result<()> {
        if self.version != FORMAT_VERSION || self.identity.hash != hash {
            return Err(CacheError::Invalid("version or identity mismatch".into()));
        }
        let mut keys = std::collections::HashSet::new();
        for c in &self.channels {
            if c.meta.key.is_empty() || !keys.insert(&c.meta.key) {
                return Err(CacheError::Invalid("duplicate/empty channel".into()));
            }
            for b in c.raw.iter().chain(c.pyramid.iter().map(|p| &p.blob)) {
                crate::storage::validate_hash(&b.checksum)?;
            }
        }
        Ok(())
    }
}
