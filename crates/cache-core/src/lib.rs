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
    /// Resolve a dataset by its stable source hash. New datasets use a human
    /// readable directory name; the old hash-only layout remains readable.
    pub fn dataset_path_for_hash(&self, hash: &str) -> Result<PathBuf> {
        self.dataset_path(hash)
    }

    pub fn dataset_relative_path(&self, hash: &str) -> Result<String> {
        let path = self.dataset_path(hash)?;
        Ok(path
            .strip_prefix(&self.path)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/"))
    }

    /// Migrate legacy hash-only folders and discard regenerated pyramid blobs.
    /// Raw blobs and original source files are kept intact.
    pub fn migrate_legacy_layout(&self) -> Result<usize> {
        let datasets = storage::safe_child(&self.path, "datasets")?;
        let mut changed = 0;
        for entry in std::fs::read_dir(&datasets)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let current = entry.file_name().to_string_lossy().into_owned();
            let manifest_path = entry.path().join("manifest.json");
            let Ok(bytes) = std::fs::read(&manifest_path) else { continue };
            let Ok(mut manifest) = serde_json::from_slice::<CacheManifest>(&bytes) else { continue };
            let hash = manifest.identity.hash.clone();
            let mut dataset_path = entry.path();
            let logical = Self::logical_dataset_name(&manifest.meta, &hash);
            if current == hash && logical != current {
                let target = datasets.join(&logical);
                if !target.exists() {
                    std::fs::rename(&dataset_path, &target)?;
                    dataset_path = target;
                    changed += 1;
                }
            }

            let mut removed_pyramid = false;
            for channel in &mut manifest.channels {
                if channel.raw.is_some() && channel.pyramid.take().is_some() {
                    removed_pyramid = true;
                }
            }
            if removed_pyramid {
                let channels_dir = dataset_path.join("channels");
                if let Ok(files) = std::fs::read_dir(channels_dir) {
                    for file in files.flatten() {
                        if file.path().extension().is_some_and(|ext| ext == "pyr") {
                            let _ = std::fs::remove_file(file.path());
                        }
                    }
                }
                manifest.update_state();
                storage::publish_manifest(&dataset_path, &manifest)?;
                changed += 1;
            }
        }
        Ok(changed)
    }

    /// Build the stable, readable directory name used for newly imported data.
    /// The short hash keeps names unique without exposing the full SHA-256.
    pub fn logical_dataset_name(meta: &telemetry_core::SessionMeta, hash: &str) -> String {
        let short_hash = hash.get(..12).unwrap_or(hash);
        [
            readable_component(&meta.date, "UNKNOWN_DATE"),
            readable_component(&meta.racer, "UNKNOWN_DRIVER"),
            readable_component(&meta.vehicle, "UNKNOWN_CAR"),
            readable_component(&meta.session, "UNKNOWN_SESSION"),
        ]
        .into_iter()
        .chain([short_hash.to_string()])
        .collect::<Vec<_>>()
        .join("_")
    }

    fn dataset_path(&self, hash: &str) -> Result<PathBuf> {
        storage::validate_hash(hash)?;
        let datasets = storage::safe_child(&self.path, "datasets")?;
        let direct = storage::safe_child(&datasets, hash)?;
        if direct.join("manifest.json").is_file() {
            return Ok(direct);
        }
        for entry in std::fs::read_dir(&datasets)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let manifest_path = entry.path().join("manifest.json");
            let Ok(bytes) = std::fs::read(&manifest_path) else { continue };
            let Ok(manifest) = serde_json::from_slice::<CacheManifest>(&bytes) else { continue };
            if manifest.identity.hash == hash {
                return Ok(entry.path());
            }
        }
        Ok(direct)
    }
    /// Publish only metadata. Repeated calls preserve existing channel progress.
    pub fn publish_metadata(
        &self,
        identity: SourceIdentity,
        meta: telemetry_core::SessionMeta,
        channels: Vec<telemetry_core::ChannelMeta>,
        laps: Vec<telemetry_core::LapInfo>,
    ) -> Result<DatasetCache> {
        self.publish_metadata_named(identity, meta, channels, laps, None)
    }

    /// Publish metadata into a readable directory name. `None` preserves the
    /// legacy hash-only layout used by fixtures and older callers.
    pub fn publish_metadata_named(
        &self,
        identity: SourceIdentity,
        meta: telemetry_core::SessionMeta,
        channels: Vec<telemetry_core::ChannelMeta>,
        laps: Vec<telemetry_core::LapInfo>,
        directory_name: Option<&str>,
    ) -> Result<DatasetCache> {
        if self.dataset(&identity.hash).is_ok() {
            return self.dataset(&identity.hash);
        }
        let datasets = storage::safe_child(&self.path, "datasets")?;
        let directory_name = directory_name.unwrap_or(&identity.hash);
        let path = storage::safe_child(&datasets, directory_name)?;
        std::fs::create_dir_all(&path)?;
        let _lock = storage::WriterLock::acquire(&path)?;
        if path.join("manifest.json").exists() {
            let existing: CacheManifest = serde_json::from_slice(&std::fs::read(path.join("manifest.json"))?)?;
            if existing.identity.hash == identity.hash {
                return self.dataset(&identity.hash);
            }
            return Err(CacheError::Invalid("dataset directory name collision".into()));
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

fn readable_component(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in value.trim().chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            if !out.ends_with('_') {
                out.push('_');
            }
        } else if ch.is_whitespace() {
            if !out.ends_with('_') {
                out.push('_');
            }
        } else {
            out.push(ch);
        }
        if out.chars().count() >= 48 {
            break;
        }
    }
    let trimmed = out.trim_matches('_').trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
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
