//! Runtime fallback for time-bucket envelopes.

/// Time and lower/upper envelopes, with equal-length arrays.
#[derive(Clone, Debug, Default)]
pub struct MinMaxFrame {
    /// First real sample time of each bucket or boundary sample.
    pub times: Vec<f64>,
    /// Finite minimum, or NaN for an all-missing bucket.
    pub mins: Vec<f32>,
    /// Finite maximum, or NaN for an all-missing bucket.
    pub maxs: Vec<f32>,
}
impl MinMaxFrame {
    pub(crate) fn push(&mut self, time: f64, min: f32, max: f32) {
        self.times.push(time);
        self.mins.push(min);
        self.maxs.push(max);
    }
}
pub(crate) fn valid_window(start: f64, end: f64) -> bool {
    start.is_finite() && end.is_finite() && start <= end && (end - start).is_finite()
}
pub(crate) fn extrema(values: impl Iterator<Item = f32>) -> (f32, f32) {
    let (mut min, mut max) = (f32::NAN, f32::NAN);
    for v in values.filter(|v| v.is_finite()) {
        min = min.min(v);
        max = max.max(v);
    }
    (min, max)
}

/// Aggregate a closed time window into equal-width columns, preserving the
/// immediately adjacent real sample before and after it when available.
/// Input times must be finite and increasing; unmatched tails are ignored.
/// Empty columns are omitted. Zero columns or an invalid window returns empty.
/// Work is O(log N + samples in window), with no scan per column.
/// ```
/// use telemetry_core::minmax_buckets;
/// let f = minmax_buckets(&[0., 1., 2., 3.], &[9., 2., 7., 8.], 1., 2., 1);
/// assert_eq!(f.times, vec![0., 1., 3.]);
/// assert_eq!(f.mins, vec![9., 2., 8.]);
/// ```
pub fn minmax_buckets(
    times: &[f64],
    values: &[f32],
    start: f64,
    end: f64,
    buckets: usize,
) -> MinMaxFrame {
    let mut out = MinMaxFrame::default();
    if buckets == 0 || !valid_window(start, end) {
        return out;
    }
    let n = times.len().min(values.len());
    let times = &times[..n];
    let left = times.partition_point(|&t| t < start);
    let right = times.partition_point(|&t| t <= end);
    if let Some(i) = left.checked_sub(1) {
        out.push(times[i], values[i], values[i]);
    }
    let column = |t: f64| {
        if start == end {
            0
        } else {
            (((t - start) / (end - start) * buckets as f64) as usize).min(buckets - 1)
        }
    };
    let mut i = left;
    while i < right {
        let first = i;
        let bucket = column(times[i]);
        i += 1;
        while i < right && column(times[i]) == bucket {
            i += 1;
        }
        let (min, max) = extrema(values[first..i].iter().copied());
        out.push(times[first], min, max);
    }
    if right < n {
        out.push(times[right], values[right], values[right]);
    }
    out
}
