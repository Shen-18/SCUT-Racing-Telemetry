use crate::{
    storage::{self, BlobReader},
    CacheError, CacheState, ChannelEntry, DatasetCache, LevelIndex, PyramidIndex, Result,
};

impl DatasetCache {
    /// Worker-only initial overview. Raw is committed first, then the coarsest
    /// (at most 512 bucket) level. A later build_pyramid completes finer levels.
    pub fn build_overview(
        &mut self,
        key: &str,
        series: &telemetry_core::ChannelSeries,
    ) -> Result<()> {
        self.write_raw(key, series)?;
        self.build_levels(key, true)
    }
    /// Job failure does not discard any published channel data.
    pub fn mark_failed(&mut self, message: &str) -> Result<()> {
        let _lock = storage::WriterLock::acquire(&self.path)?;
        self.refresh()?;
        if self.manifest.state == CacheState::Ready {
            return Err(CacheError::InvalidRequest(
                "ready dataset is terminal".into(),
            ));
        }
        self.manifest.state = CacheState::Failed;
        self.manifest.error = Some(message.into());
        storage::publish_manifest(&self.path, &self.manifest)
    }
    /// Worker-only: builds all levels from persisted raw, then publishes atomically.
    pub fn build_pyramid(&mut self, key: &str) -> Result<()> {
        self.build_levels(key, false)
    }
    pub(crate) fn build_levels(&mut self, key: &str, overview: bool) -> Result<()> {
        let _lock = storage::WriterLock::acquire(&self.path)?;
        self.refresh()?;
        let raw = self.read_raw(key)?;
        let mut pyramid = telemetry_core::build_pyramid(&raw.times, &raw.values);
        if overview && pyramid.levels.len() > 1 {
            let last = pyramid.levels.pop().unwrap();
            pyramid.levels.clear();
            pyramid.levels.push(last);
        }
        let mut offset = 16 + pyramid.levels.len() as u64 * 24;
        let levels: Vec<_> = pyramid
            .levels
            .iter()
            .map(|l| {
                let index = LevelIndex {
                    factor: l.factor,
                    count: l.times.len() as u64,
                    offset,
                };
                offset += index.count * 16;
                index
            })
            .collect();
        let mut bytes = pyramid_header(&levels);
        for level in &pyramid.levels {
            for (t, mm) in level.times.iter().zip(&level.minmax) {
                bytes.extend_from_slice(&t.to_le_bytes());
                bytes.extend_from_slice(&mm.min.to_le_bytes());
                bytes.extend_from_slice(&mm.max.to_le_bytes());
            }
        }
        let blob = storage::publish_blob(&self.path, "pyr", &bytes)?;
        let entry = self
            .manifest
            .channels
            .iter_mut()
            .find(|c| c.meta.key == key)
            .unwrap();
        entry.pyramid = Some(PyramidIndex {
            blob,
            levels,
            complete: !overview,
        });
        self.manifest.update_state();
        storage::publish_manifest(&self.path, &self.manifest)
    }
    pub fn mark_ready(&mut self) -> Result<()> {
        let _lock = storage::WriterLock::acquire(&self.path)?;
        self.refresh()?;
        self.manifest.update_state();
        if self.manifest.state != CacheState::Ready {
            return Err(CacheError::InvalidRequest("channels incomplete".into()));
        }
        storage::publish_manifest(&self.path, &self.manifest)
    }
}

fn pyramid_header(levels: &[LevelIndex]) -> Vec<u8> {
    let mut bytes = b"PYR1".to_vec();
    bytes.extend_from_slice(&1u32.to_le_bytes());
    bytes.extend_from_slice(&(levels.len() as u64).to_le_bytes());
    for l in levels {
        bytes.extend_from_slice(&l.factor.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&l.count.to_le_bytes());
        bytes.extend_from_slice(&l.offset.to_le_bytes());
    }
    bytes
}
pub(crate) fn open_pyramid(path: &std::path::Path, entry: &ChannelEntry) -> Result<BlobReader> {
    let index = entry
        .pyramid
        .as_ref()
        .ok_or_else(|| CacheError::ChannelBuilding(entry.meta.key.clone()))?;
    let mut reader = BlobReader::open(path, &index.blob, "pyr")?;
    let expected = pyramid_header(&index.levels);
    if reader.read(0, expected.len())? != expected {
        return Err(storage::invalid("pyramid header/index mismatch"));
    }
    Ok(reader)
}
