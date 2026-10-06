use crate::timeline::OutputTimeline;
use std::collections::{HashMap, HashSet};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq)]
pub struct SampleSeries {
    pub times: Vec<f64>,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GpsPoint {
    pub time: f64,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct GpsRoute {
    pub points: Vec<GpsPoint>,
}

impl GpsRoute {
    /// Keep every finite latitude/longitude sample. The route is deliberately
    /// not resampled or reduced; the renderer can cache its static geometry.
    pub fn from_series(latitude: &SampleSeries, longitude: &SampleSeries) -> Self {
        let count = latitude
            .times
            .len()
            .min(latitude.values.len())
            .min(longitude.times.len())
            .min(longitude.values.len());
        let mut points = Vec::with_capacity(count);
        for index in 0..count {
            let time = latitude.times[index];
            let lat = latitude.values[index];
            let lon = longitude.values[index];
            if time.is_finite() && lat.is_finite() && lon.is_finite() {
                points.push(GpsPoint {
                    time,
                    latitude: lat,
                    longitude: lon,
                });
            }
        }
        Self { points }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitKind {
    Plain,
    Speed,
    G,
    Torque,
    Rpm,
}

#[derive(Debug, Error, PartialEq)]
pub enum BindingError {
    #[error("ambiguous channel {0}")]
    AmbiguousChannel(String),
    #[error("unsupported {kind} unit {unit}")]
    UnsupportedUnit { kind: &'static str, unit: String },
    #[error("series times and values must have equal lengths")]
    InvalidSeries,
    #[error("series times must be finite and sorted")]
    InvalidTimes,
    #[error("speed channel is required")]
    MissingSpeed,
    #[error("one torque channel cannot be mapped to multiple motors")]
    DuplicateTorque,
}

#[derive(Debug, Clone, Default)]
pub struct BindingConfig {
    pub slots: HashMap<String, String>,
    pub max_gap_seconds: f64,
}

#[derive(Debug, Clone)]
struct PreparedSeries {
    series: SampleSeries,
    unit: String,
    minimum: f64,
    maximum: f64,
}

#[derive(Debug, Clone, Default)]
pub struct SeriesSampler {
    channels: HashMap<String, PreparedSeries>,
}

impl SeriesSampler {
    pub fn from_channels<I>(channels: I, max_gap_seconds: f64) -> Result<Self, BindingError>
    where
        I: IntoIterator<Item = (String, String, SampleSeries)>,
    {
        let mut prepared = HashMap::new();
        for (key, unit, series) in channels {
            prepared.insert(key, PreparedSeries::new(series, unit, max_gap_seconds)?);
        }
        Ok(Self { channels: prepared })
    }

    pub fn with_kind(
        mut self,
        key: String,
        unit: String,
        series: SampleSeries,
        _kind: UnitKind,
    ) -> Result<Self, BindingError> {
        self.channels
            .insert(key, PreparedSeries::new(series, unit, 0.)?);
        Ok(self)
    }

    fn sample(
        &self,
        key: &str,
        time: f64,
        kind: UnitKind,
        max_gap_seconds: f64,
    ) -> Result<f64, BindingError> {
        let Some(channel) = self.channels.get(key) else {
            return Ok(f64::NAN);
        };
        let factor = unit_factor(&channel.unit, kind)?;
        interpolate_one(&channel.series, time, factor, max_gap_seconds)
    }
}

impl PreparedSeries {
    fn new(
        series: SampleSeries,
        unit: String,
        _max_gap_seconds: f64,
    ) -> Result<Self, BindingError> {
        let series = average_duplicate_times(series)?;
        let (minimum, maximum) = series
            .values
            .iter()
            .copied()
            .filter(|value| value.is_finite())
            .fold(
                (f64::INFINITY, f64::NEG_INFINITY),
                |(minimum, maximum), value| (minimum.min(value), maximum.max(value)),
            );
        Ok(Self {
            series,
            unit,
            minimum,
            maximum,
        })
    }
}

fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn tokens(value: &str) -> HashSet<String> {
    let mut out = HashSet::new();
    let mut current = String::new();
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            current.push(c.to_ascii_lowercase());
        } else if !current.is_empty() {
            out.insert(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.insert(current);
    }
    out
}

pub fn resolve_candidate(
    candidates: &[String],
    columns: &[String],
) -> Result<Option<String>, BindingError> {
    for candidate in candidates {
        let key = normalize(candidate);
        let found: Vec<&String> = columns
            .iter()
            .filter(|column| normalize(column) == key)
            .collect();
        if found.len() > 1 {
            return Err(BindingError::AmbiguousChannel(candidate.clone()));
        }
        if let Some(value) = found.first() {
            return Ok(Some((*value).clone()));
        }
    }
    for candidate in candidates {
        let wanted = tokens(candidate);
        if wanted.is_empty() {
            continue;
        }
        let found: Vec<&String> = columns
            .iter()
            .filter(|column| tokens(column) == wanted)
            .collect();
        if found.len() > 1 {
            return Err(BindingError::AmbiguousChannel(candidate.clone()));
        }
        if let Some(value) = found.first() {
            return Ok(Some((*value).clone()));
        }
    }
    Ok(None)
}

fn average_duplicate_times(series: SampleSeries) -> Result<SampleSeries, BindingError> {
    if series.times.len() != series.values.len() {
        return Err(BindingError::InvalidSeries);
    }
    if series.times.iter().any(|time| !time.is_finite())
        || series.times.windows(2).any(|pair| pair[0] > pair[1])
    {
        return Err(BindingError::InvalidTimes);
    }
    let mut times = Vec::new();
    let mut values = Vec::new();
    let mut index = 0;
    while index < series.times.len() {
        let time = series.times[index];
        let mut sum = 0.;
        let mut count = 0usize;
        while index < series.times.len() && (series.times[index] - time).abs() <= 1e-12 {
            if series.values[index].is_finite() {
                sum += series.values[index];
                count += 1;
            }
            index += 1;
        }
        // Python drops missing values before grouping and interpolation.
        if count > 0 {
            times.push(time);
            values.push(sum / count as f64);
        }
    }
    Ok(SampleSeries { times, values })
}

fn unit_factor(unit: &str, kind: UnitKind) -> Result<f64, BindingError> {
    let normalized = unit.trim().to_lowercase();
    let factor = match kind {
        UnitKind::Plain => 1.,
        UnitKind::Speed => match normalized.as_str() {
            "m/s" | "mps" => 3.6,
            "mph" => 1.609344,
            "km/h" | "kph" | "kmh" | "" | "#" => 1.,
            _ => {
                return Err(BindingError::UnsupportedUnit {
                    kind: "speed",
                    unit: normalized,
                })
            }
        },
        UnitKind::G => match normalized.as_str() {
            "m/s2" | "m/s^2" | "m/s²" => 1. / 9.80665,
            "g" | "" | "#" => 1.,
            _ => {
                return Err(BindingError::UnsupportedUnit {
                    kind: "acceleration",
                    unit: normalized,
                })
            }
        },
        UnitKind::Torque => match normalized.as_str() {
            "nm" | "n m" | "n*m" | "n·m" | "" | "#" => 1.,
            _ => {
                return Err(BindingError::UnsupportedUnit {
                    kind: "torque",
                    unit: normalized,
                })
            }
        },
        UnitKind::Rpm => match normalized.as_str() {
            "rpm" | "" | "#" => 1.,
            _ => {
                return Err(BindingError::UnsupportedUnit {
                    kind: "rpm",
                    unit: normalized,
                })
            }
        },
    };
    Ok(factor)
}

fn interpolate_one(
    series: &SampleSeries,
    time: f64,
    factor: f64,
    max_gap_seconds: f64,
) -> Result<f64, BindingError> {
    if series.times.is_empty() || !time.is_finite() {
        return Ok(f64::NAN);
    }
    let first = series.times[0];
    let last = *series.times.last().unwrap();
    if time < first - 1e-9 || time > last + 1e-9 {
        return Ok(f64::NAN);
    }
    let right = series.times.partition_point(|sample| *sample < time);
    let value = if right == 0 {
        series.values[0] * factor
    } else if right >= series.times.len() {
        series.values[series.values.len() - 1] * factor
    } else {
        let left_index = right - 1;
        let right_index = right;
        let left_time = series.times[left_index];
        let right_time = series.times[right_index];
        if (time - right_time).abs() <= 1e-8 {
            series.values[right_index] * factor
        } else if (right_time - left_time) > max_gap_seconds {
            f64::NAN
        } else {
            let alpha = (time - left_time) / (right_time - left_time);
            (series.values[left_index]
                + (series.values[right_index] - series.values[left_index]) * alpha)
                * factor
        }
    };
    Ok(value)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OverlayFrame {
    pub video_time: f32,
    pub data_time: f32,
    pub active: bool,
    pub speed_kmh: f32,
    pub soc_percent: f32,
    pub voltage: f32,
    pub power_kw: f32,
    pub current_a: f32,
    pub steer_deg: f32,
    pub throttle_percent: f32,
    pub brake_percent: f32,
    pub g_x: f32,
    pub g_y: f32,
    pub gps_latitude: f32,
    pub gps_longitude: f32,
    pub torque_nm: [f32; 4],
    pub rpm: [f32; 4],
}

impl OverlayFrame {
    pub fn blank(video_time: f64, data_time: f64, active: bool) -> Self {
        Self {
            video_time: video_time as f32,
            data_time: data_time as f32,
            active,
            speed_kmh: f32::NAN,
            soc_percent: f32::NAN,
            voltage: f32::NAN,
            power_kw: f32::NAN,
            current_a: f32::NAN,
            steer_deg: f32::NAN,
            throttle_percent: f32::NAN,
            brake_percent: f32::NAN,
            g_x: f32::NAN,
            g_y: f32::NAN,
            gps_latitude: f32::NAN,
            gps_longitude: f32::NAN,
            torque_nm: [f32::NAN; 4],
            rpm: [f32::NAN; 4],
        }
    }
}

pub fn sample_frame(
    sampler: &SeriesSampler,
    timeline: &OutputTimeline,
    index: usize,
    bindings: &BindingConfig,
) -> Result<OverlayFrame, BindingError> {
    let video_time = timeline.frame_time(index);
    let data_time = timeline.data_time(index);
    let mut frame = OverlayFrame::blank(video_time, data_time, timeline.overlay_active(index));
    if !frame.active {
        return Ok(frame);
    }
    let get = |slot: &str, kind: UnitKind| -> Result<f32, BindingError> {
        let Some(key) = bindings.slots.get(slot) else {
            return Ok(f32::NAN);
        };
        Ok(sampler.sample(key, data_time, kind, bindings.max_gap_seconds)? as f32)
    };
    frame.speed_kmh = get("speed", UnitKind::Speed)?;
    frame.throttle_percent = get("throttle", UnitKind::Plain)?;
    frame.brake_percent = get("brake", UnitKind::Plain)?;
    if let Some(channel) = bindings
        .slots
        .get("brake")
        .and_then(|key| sampler.channels.get(key))
    {
        if frame.brake_percent.is_finite()
            && channel.minimum.is_finite()
            && channel.maximum.is_finite()
        {
            let minimum = channel.minimum;
            let maximum = channel.maximum;
            frame.brake_percent = if maximum == minimum {
                0.
            } else {
                ((frame.brake_percent as f64 - minimum) / (maximum - minimum) * 100.) as f32
            };
        }
    }
    frame.g_x = get("acc_x", UnitKind::G)?;
    frame.g_y = get("acc_y", UnitKind::G)?;
    frame.gps_latitude = get("latitude", UnitKind::Plain)?;
    frame.gps_longitude = get("longitude", UnitKind::Plain)?;
    frame.steer_deg = get("steer", UnitKind::Plain)?;
    frame.soc_percent = get("battery_soc", UnitKind::Plain)?;
    frame.voltage = get("battery_volt", UnitKind::Plain)?;
    frame.current_a = get("battery_current", UnitKind::Plain)?;
    for (index, wheel) in ["FL", "FR", "RL", "RR"].iter().enumerate() {
        frame.torque_nm[index] = get(&format!("motor_{wheel}_torque"), UnitKind::Torque)?;
        frame.rpm[index] = get(&format!("motor_{wheel}_rpm"), UnitKind::Rpm)?;
    }
    let mut assigned = HashSet::new();
    for index in 0..4 {
        let wheel = ["FL", "FR", "RL", "RR"][index];
        if let Some(key) = bindings
            .slots
            .get(&format!("motor_{wheel}_torque"))
            .filter(|key| !key.is_empty())
        {
            if !assigned.insert(key) {
                return Err(BindingError::DuplicateTorque);
            }
        }
    }
    frame.power_kw = if frame.voltage.is_finite() && frame.current_a.is_finite() {
        frame.voltage * frame.current_a / 1000.
    } else {
        f32::NAN
    };
    Ok(frame)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::{Alignment, OutputTimeline};

    fn timeline() -> OutputTimeline {
        OutputTimeline {
            alignment: Alignment {
                scale: 1.0,
                offset_seconds: 0.0,
            },
            fps: 10,
            render_fps: 10,
            width: 1280,
            height: 720,
            output_start: 0.0,
            head_frames: 0,
            content_frames: 3,
            tail_frames: 0,
            frame_count: 3,
            content_duration: 0.3,
        }
    }

    #[test]
    fn gps_route_keeps_every_finite_raw_pair_in_source_order() {
        let latitude = SampleSeries {
            times: vec![0.0, 0.1, 0.2, 0.3],
            values: vec![23.1, 23.2, f64::NAN, 23.4],
        };
        let longitude = SampleSeries {
            times: vec![0.0, 0.1, 0.2, 0.3],
            values: vec![113.3, 113.4, 113.5, 113.6],
        };
        let route = GpsRoute::from_series(&latitude, &longitude);
        assert_eq!(route.points.len(), 3);
        assert_eq!(route.points[0].latitude, 23.1);
        assert_eq!(route.points[1].longitude, 113.4);
        assert_eq!(route.points[2].latitude, 23.4);
    }

    #[test]
    fn sampled_frame_contains_live_gps_and_gforce_values() {
        let sampler = SeriesSampler::from_channels(
            [
                (
                    "lat".into(),
                    "deg".into(),
                    SampleSeries {
                        times: vec![0.0, 0.2],
                        values: vec![23.1, 23.3],
                    },
                ),
                (
                    "lon".into(),
                    "deg".into(),
                    SampleSeries {
                        times: vec![0.0, 0.2],
                        values: vec![113.3, 113.5],
                    },
                ),
                (
                    "ax".into(),
                    "g".into(),
                    SampleSeries {
                        times: vec![0.0, 0.2],
                        values: vec![0.1, 0.8],
                    },
                ),
                (
                    "ay".into(),
                    "g".into(),
                    SampleSeries {
                        times: vec![0.0, 0.2],
                        values: vec![-0.2, -0.6],
                    },
                ),
            ],
            0.5,
        )
        .unwrap();
        let bindings = BindingConfig {
            slots: HashMap::from([
                ("latitude".into(), "lat".into()),
                ("longitude".into(), "lon".into()),
                ("acc_x".into(), "ax".into()),
                ("acc_y".into(), "ay".into()),
            ]),
            max_gap_seconds: 0.5,
        };
        let frame = sample_frame(&sampler, &timeline(), 2, &bindings).unwrap();
        assert!((frame.gps_latitude - 23.3).abs() < 1e-6);
        assert!((frame.gps_longitude - 113.5).abs() < 1e-6);
        assert!((frame.g_x - 0.8).abs() < 1e-6);
        assert!((frame.g_y + 0.6).abs() < 1e-6);
    }
}
