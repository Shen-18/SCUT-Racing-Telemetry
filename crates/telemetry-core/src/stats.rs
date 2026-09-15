//! Windowed statistics and time-axis interpolation.
use crate::ChannelSeries;
/// Population statistics over a closed window.
#[derive(Clone, Debug, serde::Serialize, specta::Type)]
pub struct ChannelStats {
    /// Minimum finite value in the window.
    pub min: f32,
    /// Maximum finite value in the window.
    pub max: f32,
    /// Arithmetic mean of finite samples in the window.
    pub mean: f64,
    /// Population standard deviation of finite samples in the window.
    pub std: f64,
}
fn interp(s: &ChannelSeries, t: f64) -> Option<f64> {
    let n = s.len();
    if n == 0 {
        return None;
    }
    let times = &s.times[..n];
    let values = &s.values[..n];
    if t < times[0] || t > times[n - 1] {
        return None;
    }
    let i = times.partition_point(|&x| x < t);
    if i < n && times[i] == t {
        let v = values[i];
        return if v.is_finite() { Some(v as f64) } else { None };
    }
    if i == 0 || i == n {
        return None;
    }
    let (t0, t1) = (times[i - 1], times[i]);
    let (v0, v1) = (values[i - 1], values[i]);
    if !v0.is_finite() || !v1.is_finite() || t1 <= t0 {
        return None;
    }
    Some(v0 as f64 + (v1 - v0) as f64 * (t - t0) / (t1 - t0))
}
/// Compute min, max, mean and population standard deviation, skipping non-finite values.
pub fn channel_stats(s: &ChannelSeries, w: (f64, f64)) -> ChannelStats {
    let n = s.len();
    let a: Vec<f64> = s.times[..n]
        .iter()
        .zip(&s.values[..n])
        .filter(|(t, v)| **t >= w.0 && **t <= w.1 && v.is_finite())
        .map(|(_, v)| *v as f64)
        .collect();
    if a.is_empty() {
        return ChannelStats {
            min: f32::NAN,
            max: f32::NAN,
            mean: f64::NAN,
            std: f64::NAN,
        };
    }
    let m = a.iter().sum::<f64>() / a.len() as f64;
    ChannelStats {
        min: a.iter().copied().fold(f64::INFINITY, f64::min) as f32,
        max: a.iter().copied().fold(f64::NEG_INFINITY, f64::max) as f32,
        mean: m,
        std: (a.iter().map(|x| (x - m).powi(2)).sum::<f64>() / a.len() as f64).sqrt(),
    }
}
/// Compare channels after linearly interpolating both onto the union of timestamps in their overlap.
pub fn rmse_and_corr(a: &ChannelSeries, b: &ChannelSeries, w: (f64, f64)) -> (f64, f64) {
    if w.0 > w.1 {
        return (f64::NAN, f64::NAN);
    }
    let a_times = &a.times[..a.len()];
    let b_times = &b.times[..b.len()];
    let lo =
        w.0.max(a_times.first().copied().unwrap_or(f64::INFINITY))
            .max(b_times.first().copied().unwrap_or(f64::INFINITY));
    let hi =
        w.1.min(a_times.last().copied().unwrap_or(f64::NEG_INFINITY))
            .min(b_times.last().copied().unwrap_or(f64::NEG_INFINITY));
    if lo > hi {
        return (f64::NAN, f64::NAN);
    }
    let mut ts: Vec<f64> = a_times
        .iter()
        .chain(b_times)
        .copied()
        .filter(|t| *t >= lo && *t <= hi)
        .collect();
    ts.push(lo);
    ts.push(hi);
    ts.sort_by(f64::total_cmp);
    ts.dedup();
    let p: Vec<_> = ts
        .into_iter()
        .filter_map(|t| Some((interp(a, t)?, interp(b, t)?)))
        .collect();
    if p.is_empty() {
        return (f64::NAN, f64::NAN);
    }
    let ma = p.iter().map(|x| x.0).sum::<f64>() / p.len() as f64;
    let mb = p.iter().map(|x| x.1).sum::<f64>() / p.len() as f64;
    let rm = (p.iter().map(|x| (x.0 - x.1).powi(2)).sum::<f64>() / p.len() as f64).sqrt();
    let (x, y, c) = p.iter().fold((0., 0., 0.), |(x, y, c), (u, v)| {
        (
            x + (u - ma).powi(2),
            y + (v - mb).powi(2),
            c + (u - ma) * (v - mb),
        )
    });
    (
        rm,
        if x == 0. || y == 0. {
            f64::NAN
        } else {
            c / (x * y).sqrt()
        },
    )
}
