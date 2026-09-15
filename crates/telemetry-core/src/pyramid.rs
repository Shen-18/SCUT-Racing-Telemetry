//! Power-of-two sample-count envelopes with first-sample timestamps.
use crate::downsample::{extrema, valid_window};
use crate::MinMaxFrame;

/// Finite envelope; both values are NaN when all source values are missing.
#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct MinMax {
    /// Minimum sample value.
    pub min: f32,
    /// Maximum sample value.
    pub max: f32,
}
/// One pyramid layer with possibly a partial final bucket.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct PyramidLevel {
    /// Number of original samples per full bucket: 2, 4, 8, ...
    pub factor: u32,
    /// Timestamp of the first original sample in each bucket.
    pub times: Vec<f64>,
    /// Envelopes paired with times.
    pub minmax: Vec<MinMax>,
}
/// Ordered pyramid; raw samples are not stored here.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct ChannelPyramid {
    /// Levels in ascending factor order, beginning with 2x.
    pub levels: Vec<PyramidLevel>,
}

/// Build from 2x until the first level with at most 512 buckets (inclusive).
/// Times must be finite and increasing. A single sample forms a partial 2x
/// bucket; empty paired input yields no levels. Construction is O(N).
/// ```
/// use telemetry_core::build_pyramid;
/// let p = build_pyramid(&[0., 0.2, 1.], &[7., 2., 9.]);
/// assert_eq!(p.levels[0].times, vec![0., 1.]);
/// assert_eq!(p.levels[0].minmax[0].min, 2.);
/// ```
pub fn build_pyramid(times: &[f64], values: &[f32]) -> ChannelPyramid {
    let n = times.len().min(values.len());
    let mut out = ChannelPyramid::default();
    if n == 0 {
        return out;
    }
    let mut level = PyramidLevel {
        factor: 2,
        ..Default::default()
    };
    for (i, chunk) in values[..n].chunks(2).enumerate() {
        let (min, max) = extrema(chunk.iter().copied());
        level.times.push(times[i * 2]);
        level.minmax.push(MinMax { min, max });
    }
    loop {
        let done = level.minmax.len() <= 512;
        out.levels.push(level);
        if done {
            break;
        }
        let Some(previous) = out.levels.last() else {
            break;
        };
        let Some(factor) = previous.factor.checked_mul(2) else {
            break;
        };
        let mut next = PyramidLevel {
            factor,
            ..Default::default()
        };
        for (i, chunk) in previous.minmax.chunks(2).enumerate() {
            let (min, max) = extrema(chunk.iter().flat_map(|m| [m.min, m.max]));
            next.times.push(previous.times[i * 2]);
            next.minmax.push(MinMax { min, max });
        }
        level = next;
    }
    out
}

// Include the bucket owning start, even if its first sample precedes start.
fn window_indices(level: &PyramidLevel, start: f64, end: f64) -> (usize, usize) {
    let n = level.times.len().min(level.minmax.len());
    let times = &level.times[..n];
    let left = times.partition_point(|&t| t <= start).saturating_sub(1);
    let right = times.partition_point(|&t| t <= end);
    (left.min(right), right)
}

/// Return the finest stored layer whose intersecting buckets fit 2*pixels.
/// Includes the bucket covering the left edge, preserving its envelope.
/// Return None for zero pixels, invalid windows, no fitting layer, or a window
/// fine enough for raw. With no raw timestamps in this contract, raw density
/// is conservatively estimated as twice the intersecting 2x bucket count.
/// Callers must handle None using raw plus runtime downsampling as necessary.
/// Valid pyramids have increasing times and factors. Lookup uses binary search
/// per level and copies only selected buckets, never scans all stored samples.
pub fn query_pyramid(
    pyr: &ChannelPyramid,
    start: f64,
    end: f64,
    pixels: u32,
) -> Option<MinMaxFrame> {
    if pixels == 0 || !valid_window(start, end) {
        return None;
    }
    let first = pyr.levels.first()?;
    let (left, right) = window_indices(first, start, end);
    let limit = u64::from(pixels) * 2;
    if (right - left) as u64 * u64::from(first.factor) <= limit {
        return None;
    }
    for level in &pyr.levels {
        let (left, right) = window_indices(level, start, end);
        if right > left && (right - left) as u64 <= limit {
            let mut out = MinMaxFrame::default();
            for i in left..right {
                out.push(level.times[i], level.minmax[i].min, level.minmax[i].max);
            }
            return Some(out);
        }
    }
    None
}
