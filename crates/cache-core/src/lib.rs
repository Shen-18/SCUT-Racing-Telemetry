//! Persistent, metadata-first telemetry cache. Scheduling belongs to the host.
#![forbid(unsafe_code)]
mod frame;
mod manifest;
mod pyramid;
mod raw;
mod storage;
pub use manifest::*;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("manifest: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid cache: {0}")]
    Invalid(String),
    #[error("channel_building: {0}")]
    ChannelBuilding(String),
    #[error("unknown channel: {0}")]
    UnknownChannel(String),
    #[error("dataset writer busy")]
    Busy,
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("no stored level fits the requested pixel budget")]
    ResolutionUnavailable,
}
pub type Result<T> = std::result::Result<T, CacheError>;

#[derive(Clone, Debug)]
pub struct CacheRoot {
    path: PathBuf,
}
impl CacheRoot {
    pub fn open(path: &Path) -> Result<Self> {
        std::fs::create_dir_all(path)?;
        let path = path.canonicalize()?;
        storage::directory(&path, "datasets")?;
        Ok(Self { path })
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn bytes(&self) -> Result<u64> {
        fn total(path: &Path) -> std::io::Result<u64> {
            let mut size = 0;
            for entry in std::fs::read_dir(path)? {
                let entry = entry?;
                let meta = entry.metadata()?;
                size += if meta.is_dir() {
                    total(&entry.path())?
                } else {
                    meta.len()
                };
            }
            Ok(size)
        }
        total(&self.path).map_err(CacheError::Io)
    }
    pub fn dataset(&self, hash: &str) -> Result<DatasetCache> {
        DatasetCache::open(self, hash)
    }
    pub(crate) fn dataset_path(&self, hash: &str) -> Result<PathBuf> {
        storage::validate_hash(hash)?;
        let datasets = storage::safe_child(&self.path, "datasets")?;
        storage::safe_child(&datasets, hash)
    }
    /// Publish only metadata. Repeated calls preserve existing channel progress.
    pub fn publish_metadata(
        &self,
        identity: SourceIdentity,
        meta: telemetry_core::SessionMeta,
        channels: Vec<telemetry_core::ChannelMeta>,
        laps: Vec<telemetry_core::LapInfo>,
    ) -> Result<DatasetCache> {
        let path = self.dataset_path(&identity.hash)?;
        std::fs::create_dir_all(&path)?;
        let _lock = storage::WriterLock::acquire(&path)?;
        if path.join("manifest.json").exists() {
            return self.dataset(&identity.hash);
        }
        storage::directory(&path, "channels")?;
        storage::directory(&path, "temp")?;
        let mut seen = std::collections::HashSet::new();
        if channels
            .iter()
            .any(|c| c.key.is_empty() || !seen.insert(c.key.clone()))
        {
            return Err(CacheError::InvalidRequest(
                "empty or duplicate channel key".into(),
            ));
        }
        let manifest = CacheManifest {
            version: FORMAT_VERSION,
            identity,
            meta,
            laps,
            state: CacheState::MetadataReady,
            error: None,
            channels: channels
                .into_iter()
                .map(|meta| ChannelEntry {
                    meta: meta.into(),
                    raw: None,
                    pyramid: None,
                    full_count: 0,
                    last_time: None,
                })
                .collect(),
        };
        storage::publish_manifest(&path, &manifest)?;
        self.dataset(&manifest.identity.hash)
    }
}

/// A manifest snapshot; opening never reads channel files or source samples.
#[derive(Debug)]
pub struct DatasetCache {
    pub(crate) path: PathBuf,
    pub(crate) manifest: CacheManifest,
}
impl DatasetCache {
    pub fn open(root: &CacheRoot, hash: &str) -> Result<Self> {
        let path = root.dataset_path(hash)?;
        let manifest: CacheManifest = serde_json::from_slice(&std::fs::read(
            storage::safe_child(&path, "manifest.json")?,
        )?)?;
        manifest.validate(hash)?;
        Ok(Self { path, manifest })
    }
    pub fn manifest(&self) -> &CacheManifest {
        &self.manifest
    }
    pub fn refresh(&mut self) -> Result<()> {
        let manifest: CacheManifest = serde_json::from_slice(&std::fs::read(
            storage::safe_child(&self.path, "manifest.json")?,
        )?)?;
        manifest.validate(&self.manifest.identity.hash)?;
        self.manifest = manifest;
        Ok(())
    }
    pub fn laps(&self) -> &[telemetry_core::LapInfo] {
        &self.manifest.laps
    }
    pub(crate) fn entry(&self, key: &str) -> Result<&ChannelEntry> {
        self.manifest
            .channels
            .iter()
            .find(|c| c.meta.key == key)
            .ok_or_else(|| CacheError::UnknownChannel(key.into()))
    }
}
