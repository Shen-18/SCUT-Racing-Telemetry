use crate::{
    storage::{self, BlobReader},
    CacheError, CacheRoot, ChannelEntry, DatasetCache, Result,
};
use telemetry_core::ChannelSeries;

impl CacheRoot {
    /// Worker-only write; commits raw independently so cancellation is resumable.
    /// Replacing raw invalidates its old pyramid in the same manifest transaction.
    pub fn publish_raw(&self, hash: &str, key: &str, series: &ChannelSeries) -> Result<()> {
        validate_series(series)?;
        let path = self.dataset_path(hash)?;
        let _lock = storage::WriterLock::acquire(&path)?;
        let mut cache = self.dataset(hash)?;
        let entry = cache
            .manifest
            .channels
            .iter_mut()
            .find(|c| c.meta.key == key)
            .ok_or_else(|| CacheError::UnknownChannel(key.into()))?;
        let mut bytes = Vec::with_capacity(16 + series.len() * 12);
        bytes.extend_from_slice(b"RAW1");
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&(series.len() as u64).to_le_bytes());
        for t in &series.times {
            bytes.extend_from_slice(&t.to_le_bytes());
        }
        for v in &series.values {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        entry.raw = Some(storage::publish_blob(&path, "raw", &bytes)?);
        entry.full_count = series.len() as u64;
        entry.last_time = series.times.last().copied();
        entry.pyramid = None;
        cache.manifest.update_state();
        storage::publish_manifest(&path, &cache.manifest)
    }
}
pub(crate) fn validate_series(s: &ChannelSeries) -> Result<()> {
    if s.times.len() != s.values.len()
        || s.times.iter().any(|t| !t.is_finite())
        || s.times.windows(2).any(|p| p[0] >= p[1])
    {
        return Err(CacheError::InvalidRequest(
            "paired samples with finite strictly increasing times required".into(),
        ));
    }
    Ok(())
}
pub(crate) fn open_raw(path: &std::path::Path, entry: &ChannelEntry) -> Result<BlobReader> {
    let blob = entry
        .raw
        .as_ref()
        .ok_or_else(|| CacheError::ChannelBuilding(entry.meta.key.clone()))?;
    let size = entry
        .full_count
        .checked_mul(12)
        .and_then(|n| n.checked_add(16))
        .ok_or_else(|| storage::invalid("raw size overflow"))?;
    if blob.bytes != size {
        return Err(storage::invalid("raw count mismatch"));
    }
    let mut reader = BlobReader::open(path, blob, "raw")?;
    let mut expected = b"RAW1".to_vec();
    expected.extend_from_slice(&1u32.to_le_bytes());
    expected.extend_from_slice(&entry.full_count.to_le_bytes());
    if reader.read(0, 16)? != expected {
        return Err(storage::invalid("raw header mismatch"));
    }
    Ok(reader)
}
impl DatasetCache {
    /// Exact timestamp span covered by the requested raw channels.
    pub fn sample_range(&self, keys: &[String]) -> Result<Option<(f64, f64)>> {
        let requested: Vec<&str> = if keys.is_empty() {
            self.manifest
                .channels
                .iter()
                .map(|c| c.meta.key.as_str())
                .collect()
        } else {
            keys.iter().map(String::as_str).collect()
        };
        let mut start = f64::INFINITY;
        let mut end = f64::NEG_INFINITY;
        for key in requested {
            let entry = self.entry(key)?;
            if entry.full_count == 0 {
                continue;
            }
            let mut reader = open_raw(&self.path, entry)?;
            let first = reader.f64(16)?;
            let last = entry.last_time.unwrap_or(first);
            if first.is_finite() {
                start = start.min(first);
            }
            if last.is_finite() {
                end = end.max(last);
            }
        }
        Ok((start.is_finite() && end.is_finite() && start <= end).then_some((start, end)))
    }

    /// Common interval covered by every requested raw channel.
    ///
    /// This is deliberately different from `sample_range`, which returns the
    /// union of the channels' ranges.  A shared chart cursor must not enter a
    /// tail where one of the selected channels has no real sample.
    pub fn sample_overlap(&self, keys: &[String]) -> Result<Option<(f64, f64)>> {
        let requested: Vec<&str> = if keys.is_empty() {
            self.manifest
                .channels
                .iter()
                .map(|c| c.meta.key.as_str())
                .collect()
        } else {
            keys.iter().map(String::as_str).collect()
        };
        let mut start = f64::NEG_INFINITY;
        let mut end = f64::INFINITY;
        let mut found = false;
        for key in requested {
            let entry = self.entry(key)?;
            if entry.full_count == 0 {
                continue;
            }
            let mut reader = open_raw(&self.path, entry)?;
            let first = reader.f64(16)?;
            let last = entry.last_time.unwrap_or(first);
            if !first.is_finite() || !last.is_finite() {
                continue;
            }
            found = true;
            start = start.max(first);
            end = end.min(last);
        }
        Ok((found && start.is_finite() && end.is_finite() && start <= end).then_some((start, end)))
    }

    pub(crate) fn root(&self) -> CacheRoot {
        CacheRoot {
            path: self.path.parent().unwrap().parent().unwrap().to_owned(),
        }
    }
    pub fn write_raw(&mut self, key: &str, series: &ChannelSeries) -> Result<()> {
        self.root()
            .publish_raw(&self.manifest.identity.hash, key, series)?;
        self.refresh()
    }
    /// Explicit full-resolution worker/export operation. Never called by frame reads.
    pub fn read_raw(&self, key: &str) -> Result<ChannelSeries> {
        let entry = self.entry(key)?;
        let mut reader = open_raw(&self.path, entry)?;
        let n = usize::try_from(entry.full_count).map_err(|_| storage::invalid("raw too large"))?;
        let times = reader
            .read(
                16,
                n.checked_mul(8)
                    .ok_or_else(|| storage::invalid("raw too large"))?,
            )?
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| f64::from_le_bytes(*b))
            .collect();
        let values = reader
            .read(
                16 + entry.full_count * 8,
                n.checked_mul(4)
                    .ok_or_else(|| storage::invalid("raw too large"))?,
            )?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        let series = ChannelSeries { times, values };
        validate_series(&series)?;
        Ok(series)
    }
    /// Step-hold cursor lookup bounded to native sample range; empty or out-of-range returns NaN.
    pub fn read_cursor_values(&self, keys: &[String], t: f64) -> Result<Vec<f32>> {
        if !t.is_finite() {
            return Err(CacheError::InvalidRequest("non-finite cursor".into()));
        }
        keys.iter()
            .map(|key| {
                let entry = self.entry(key)?;
                let mut reader = open_raw(&self.path, entry)?;
                if entry.full_count == 0 {
                    return Ok(f32::NAN);
                }
                let first = reader.f64(16)?;
                let last = entry.last_time.unwrap_or(first);
                if t < first - 1e-9 || t > last + 1e-9 {
                    return Ok(f32::NAN);
                }
                let index = storage::upper_bound(&mut reader, 16, 8, entry.full_count, t)?
                    .saturating_sub(1);
                reader.f32(16 + entry.full_count * 8 + index * 4)
            })
            .collect()
    }
}
