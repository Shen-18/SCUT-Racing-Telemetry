use crate::{
    pyramid::open_pyramid,
    raw::open_raw,
    storage::{self, BlobReader},
    CacheError, DatasetCache, LevelIndex, Result,
};
use serde::Serialize;

#[derive(Serialize)]
struct FrameHeader<'a> {
    channel: &'a str,
    unit: &'a str,
    buckets: usize,
    win_start: f64,
    win_end: f64,
    full_count: u64,
    generation: u64,
}
impl DatasetCache {
    /// Bounded random reads from the precomputed pyramid, or every raw sample
    /// when the caller requests the explicit exact/raw mode.
    pub fn read_window_frame(
        &self,
        key: &str,
        start: f64,
        end: f64,
        pixels: u32,
        generation: u64,
    ) -> Result<Vec<u8>> {
        if !start.is_finite() || !end.is_finite() || start > end || pixels == 0 {
            return Err(CacheError::InvalidRequest(
                "finite ordered window and nonzero pixels required".into(),
            ));
        }
        let entry = self.entry(key)?;
        // u32::MAX is the explicit exact/raw mode used by analysis charts.
        // It bypasses pyramid buckets and returns every raw sample in range.
        if pixels == u32::MAX || entry.pyramid.is_none() {
            let mut reader = open_raw(&self.path, entry)?;
            let left = storage::lower_bound(&mut reader, 16, 8, entry.full_count, start)?;
            let right = storage::upper_bound(&mut reader, 16, 8, entry.full_count, end)?;
            let count = right.saturating_sub(left);
            let mut times = Vec::with_capacity(count as usize);
            let mut values = Vec::with_capacity(count as usize);
            let time_bytes = reader.read(
                16 + left * 8,
                usize::try_from(count.checked_mul(8).ok_or_else(|| storage::invalid("frame too large"))?)
                    .map_err(|_| storage::invalid("frame too large"))?,
            )?;
            let value_bytes = reader.read(
                16 + entry.full_count * 8 + left * 8,
                usize::try_from(count.checked_mul(8).ok_or_else(|| storage::invalid("frame too large"))?)
                    .map_err(|_| storage::invalid("frame too large"))?,
            )?;
            for bytes in time_bytes.as_chunks::<8>().0 {
                times.push(f64::from_le_bytes(*bytes));
            }
            for bytes in value_bytes.as_chunks::<8>().0 {
                values.push(f64::from_le_bytes(*bytes));
            }
            let mins = values.clone();
            let maxs = values;
            let header = FrameHeader {
                channel: key,
                unit: &entry.meta.unit,
                buckets: times.len(),
                win_start: start,
                win_end: end,
                full_count: entry.full_count,
                generation,
            };
            return encode(header, times, mins, maxs);
        }
        let pyramid = entry
            .pyramid
            .as_ref()
            .ok_or_else(|| CacheError::ChannelBuilding(key.into()))?;
        let mut reader = open_pyramid(&self.path, entry)?;
        let (mut times, mut mins, mut maxs) = (Vec::new(), Vec::new(), Vec::new());
        if entry.last_time.is_some_and(|t| start <= t) && entry.full_count > 0 {
            let budget = u64::from(pixels) * 2;
            let mut selection = None;
            for level in &pyramid.levels {
                let (left, right) = window(&mut reader, level, start, end)?;
                if right - left <= budget {
                    selection = Some((level, left, right));
                    break;
                }
            }
            let (level, left, right) = selection.ok_or(CacheError::ResolutionUnavailable)?;
            let n =
                usize::try_from(right - left).map_err(|_| storage::invalid("frame too large"))?;
            let bytes = reader.read(
                level.offset + left * 24,
                n.checked_mul(24)
                    .ok_or_else(|| storage::invalid("frame too large"))?,
            )?;
            for b in bytes.as_chunks::<24>().0 {
                times.push(f64::from_le_bytes(b[..8].try_into().unwrap()));
                mins.push(f64::from_le_bytes(b[8..16].try_into().unwrap()));
                maxs.push(f64::from_le_bytes(b[16..24].try_into().unwrap()));
            }
            if let Some(last_time) = entry.last_time {
                let needs_endpoint = times.last().is_none_or(|t| *t < last_time - 1e-9);
                if needs_endpoint && last_time >= start - 1e-9 && last_time <= end + 1e-9 {
                    if let Ok(mut reader) = open_raw(&self.path, entry) {
                        if let Ok(value) = reader.f64(16 + entry.full_count * 8 + (entry.full_count - 1) * 8) {
                            times.push(last_time);
                            mins.push(value);
                            maxs.push(value);
                        }
                    }
                }
            }
        }
        let header = FrameHeader {
            channel: key,
            unit: &entry.meta.unit,
            buckets: times.len(),
            win_start: start,
            win_end: end,
            full_count: entry.full_count,
            generation,
        };
        encode(header, times, mins, maxs)
    }
}
pub(crate) fn window(
    reader: &mut BlobReader,
    l: &LevelIndex,
    start: f64,
    end: f64,
) -> Result<(u64, u64)> {
    let left = storage::lower_bound(reader, l.offset, 24, l.count, start)?;
    let right = storage::upper_bound(reader, l.offset, 24, l.count, end)?;
    Ok((left.min(right), right))
}
fn encode(
    header: FrameHeader<'_>,
    times: Vec<f64>,
    mins: Vec<f64>,
    maxs: Vec<f64>,
) -> Result<Vec<u8>> {
    let mut json = serde_json::to_vec(&header)?;
    // Align times for JS Float64Array views; JSON whitespace is insignificant.
    while !(8 + json.len()).is_multiple_of(8) {
        json.push(b' ');
    }
    let header_len =
        u32::try_from(json.len()).map_err(|_| storage::invalid("frame header too large"))?;
    let mut bytes = b"SXK1".to_vec();
    bytes.extend_from_slice(&header_len.to_le_bytes());
    bytes.extend_from_slice(&json);
    for t in times {
        bytes.extend_from_slice(&t.to_le_bytes());
    }
    for v in mins.into_iter().chain(maxs) {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    Ok(bytes)
}
