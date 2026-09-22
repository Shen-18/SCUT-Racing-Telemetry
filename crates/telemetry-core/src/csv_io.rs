//! SCUT 规范 CSV v1，结构与 AiM CSV File 导出保持兼容。

use crate::{ChannelMeta, ChannelSeries, TelemetryError};

pub const CSV_FORMAT_TAG: &str = "AiM CSV File";
const MAX_GRID_HZ: f64 = 500.0;
const MIN_GRID_HZ: f64 = 1.0;

pub struct GriddedChannel {
    pub name: String,
    pub unit: String,
    pub values: Vec<f32>,
}
pub struct Gridded {
    pub grid_hz: f64,
    pub times: Vec<f64>,
    pub channels: Vec<GriddedChannel>,
}

fn median_positive_diff(times: &[f64]) -> Option<f64> {
    let mut diffs: Vec<f64> = times
        .windows(2)
        .filter_map(|w| {
            let d = w[1] - w[0];
            d.is_finite().then_some(d).filter(|d| *d > 0.0)
        })
        .collect();
    if diffs.is_empty() {
        return None;
    }
    diffs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Some(diffs[diffs.len() / 2])
}

fn channel_grid_values(times: &[f64], values: &[f32], grid: &[f64]) -> Vec<f32> {
    let Some(first_time) = times.first().copied() else {
        return vec![f32::NAN; grid.len()];
    };
    let last_time = times.last().copied().unwrap_or(first_time);
    let mut out = Vec::with_capacity(grid.len());
    let mut cursor = 0usize;
    let mut current = None;
    for &t in grid {
        while cursor < times.len() && times[cursor] <= t {
            if values.get(cursor).is_some_and(|v| v.is_finite()) {
                current = values.get(cursor).copied();
            }
            cursor += 1;
        }
        if t < first_time - 1e-9 || t > last_time + 1e-9 {
            out.push(f32::NAN);
        } else {
            out.push(current.unwrap_or(f32::NAN));
        }
    }
    out
}

pub fn gridify(
    duration_hint: f64,
    channels: &[(&ChannelMeta, &ChannelSeries)],
) -> Result<Gridded, TelemetryError> {
    let max_rate = channels
        .iter()
        .filter_map(|(_, s)| median_positive_diff(&s.times))
        .map(|diff| 1.0 / diff)
        .filter(|rate| rate.is_finite())
        .fold(0.0, f64::max);
    let grid_hz = ((max_rate * 1000.0).round() / 1000.0).clamp(MIN_GRID_HZ, MAX_GRID_HZ);
    let sample_end = channels
        .iter()
        .filter_map(|(_, s)| s.times.iter().rev().find(|t| t.is_finite()).copied())
        .reduce(f64::max);
    // Metadata duration must never create synthetic samples after the last
    // timestamp that actually exists in the source channels.
    let t_end = sample_end.unwrap_or_else(|| duration_hint.max(0.0));
    if t_end <= 0.0 {
        return Err(TelemetryError::Parse(
            "cannot build CSV grid: no samples or non-positive duration".into(),
        ));
    }
    let count = (t_end * grid_hz).floor() as usize + 1;
    let times: Vec<f64> = (0..count).map(|i| i as f64 / grid_hz).collect();
    let channels = channels
        .iter()
        .map(|(meta, series)| GriddedChannel {
            name: meta.name.clone(),
            unit: meta.unit.clone(),
            values: channel_grid_values(&series.times, &series.values, &times),
        })
        .collect();
    Ok(Gridded {
        grid_hz,
        times,
        channels,
    })
}

fn csv_field(text: &str) -> String {
    format!(
        "\"{}\"",
        text.replace(['\r', '\n'], " ").replace('"', "\"\"")
    )
}
fn format_value(value: f32) -> String {
    if value.is_finite() {
        format!("{value:.9}")
    } else {
        String::new()
    }
}

pub fn write_aim_csv<W: std::io::Write>(
    w: &mut W,
    meta: &crate::SessionMeta,
    grid: &Gridded,
    lap_count: usize,
) -> Result<(), TelemetryError> {
    if grid.channels.is_empty() || grid.times.is_empty() {
        return Err(TelemetryError::Parse(
            "refusing to write empty CSV grid".into(),
        ));
    }
    writeln!(w, "{},{}", csv_field("Format"), csv_field(CSV_FORMAT_TAG))?;
    for (key, value) in [
        ("Session", &meta.session),
        ("Vehicle", &meta.vehicle),
        ("Racer", &meta.racer),
        ("Championship", &meta.championship),
        ("Comment", &meta.comment),
        ("Date", &meta.date),
        ("Time", &meta.start_time),
    ] {
        writeln!(w, "{},{}", csv_field(key), csv_field(value))?;
    }
    writeln!(w)?;
    writeln!(
        w,
        "{},{}",
        csv_field("Sample Rate"),
        csv_field(&format!("{:.3}", grid.grid_hz))
    )?;
    writeln!(
        w,
        "{},{}",
        csv_field("Duration"),
        csv_field(&format!("{:.2}", grid.times.last().copied().unwrap_or(0.0)))
    )?;
    writeln!(w, "{},{}", csv_field("Segment"), csv_field("Session"))?;
    writeln!(
        w,
        "{},{}",
        csv_field("Beacon Markers"),
        csv_field(&lap_count.to_string())
    )?;
    writeln!(w, "{},{}", csv_field("Segment Times"), csv_field(""))?;
    writeln!(w)?;
    let mut names = vec![csv_field("Time")];
    let mut units = vec![csv_field("s")];
    for channel in &grid.channels {
        names.push(csv_field(&channel.name));
        units.push(csv_field(&channel.unit));
    }
    writeln!(w, "{}", names.join(","))?;
    writeln!(w, "{}", units.join(","))?;
    for (index, time) in grid.times.iter().enumerate() {
        // Exported telemetry is sampled at the grid rate (normally 100 Hz),
        // so hundredths of a second are the truthful precision of this table.
        // Channel values retain their full numeric precision below.
        let mut row = vec![csv_field(&format!("{time:.2}"))];
        row.extend(
            grid.channels
                .iter()
                .map(|channel| csv_field(&format_value(channel.values[index]))),
        );
        writeln!(w, "{}", row.join(","))?;
    }
    Ok(())
}

pub fn parse_csv_records(text: &str) -> Vec<Vec<String>> {
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    field.push('"');
                } else {
                    quotes = false;
                }
            } else {
                field.push(ch);
            }
        } else {
            match ch {
                '"' => quotes = true,
                ',' => record.push(std::mem::take(&mut field)),
                '\n' => {
                    record.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut record));
                }
                '\r' => {}
                other => field.push(other),
            }
        }
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records
}

#[derive(Debug)]
pub struct AimCsv {
    pub sample_rate_hz: f64,
    pub duration: f64,
    pub session: String,
    pub vehicle: String,
    pub racer: String,
    pub championship: String,
    pub comment: String,
    pub date: String,
    pub start_time: String,
    pub channel_names: Vec<String>,
    pub channel_units: Vec<String>,
    pub times: Vec<f64>,
    pub columns: Vec<Vec<f32>>,
}

pub fn read_aim_csv(text: &str) -> Result<AimCsv, TelemetryError> {
    let records = parse_csv_records(text.strip_prefix('\u{feff}').unwrap_or(text));
    let mut pairs = Vec::new();
    let mut names = None;
    let mut units = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in &records {
        if record.iter().all(String::is_empty) {
            continue;
        }
        if record.first().map(String::as_str) == Some("Time") {
            let second = record.get(1).map(String::as_str).unwrap_or_default();
            let looks_like_metadata_time =
                second.contains(':') || second.ends_with("AM") || second.ends_with("PM");
            if record.len() > 2 || !looks_like_metadata_time {
                names = Some(record.clone());
                units.clear();
                continue;
            }
        }
        if names.is_some()
            && (record.first().map(String::as_str) == Some("s")
                || record.first().and_then(|v| v.parse::<f64>().ok()).is_none())
        {
            if units.is_empty() {
                units = record[1..].to_vec();
            } else if record.len() > 1 {
                rows.push(record.clone());
            }
        } else if names.is_some() && record.first().and_then(|v| v.parse::<f64>().ok()).is_some() {
            rows.push(record.clone());
        } else if record.len() == 2 {
            pairs.push((record[0].clone(), record[1].clone()));
        }
    }
    if !pairs.iter().any(|(key, _)| key == "Format") {
        return Err(TelemetryError::Parse(
            "CSV is missing the Format marker".into(),
        ));
    }
    let lookup = |key: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    };
    let names = names.ok_or_else(|| {
        TelemetryError::Parse("channel header row starting with Time not found".into())
    })?;
    let channel_names = names[1..].to_vec();
    if units.is_empty() {
        units = vec![String::new(); channel_names.len()];
    }
    let mut times = Vec::new();
    let mut columns = vec![Vec::new(); channel_names.len()];
    for row in rows {
        if row.len() != names.len() {
            continue;
        }
        let Ok(time) = row[0].parse::<f64>() else {
            continue;
        };
        if !time.is_finite() {
            continue;
        }
        times.push(time);
        for (i, value) in row[1..].iter().enumerate() {
            columns[i].push(value.parse::<f32>().unwrap_or(f32::NAN));
        }
    }
    if times.is_empty() {
        return Err(TelemetryError::Parse("CSV has no data rows".into()));
    }
    // RaceStudio 多设备交错导出的 Time 列可能非严格递增（同一时刻出现多行）；
    // raw 缓存要求严格递增，故按时间稳定排序，同刻只保留最后一个样本。
    let (times, columns) = {
        let mut order: Vec<usize> = (0..times.len()).collect();
        order.sort_by(|&a, &b| {
            times[a]
                .partial_cmp(&times[b])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut sorted_times: Vec<f64> = Vec::with_capacity(times.len());
        let mut sorted_columns: Vec<Vec<f32>> = columns
            .iter()
            .map(|_| Vec::with_capacity(times.len()))
            .collect();
        for index in order {
            let time = times[index];
            if sorted_times.last().is_some_and(|&prev| prev >= time) {
                *sorted_times.last_mut().unwrap() = time;
                for (column, sorted) in columns.iter().zip(sorted_columns.iter_mut()) {
                    *sorted.last_mut().unwrap() = column[index];
                }
            } else {
                sorted_times.push(time);
                for (column, sorted) in columns.iter().zip(sorted_columns.iter_mut()) {
                    sorted.push(column[index]);
                }
            }
        }
        (sorted_times, sorted_columns)
    };
    Ok(AimCsv {
        sample_rate_hz: lookup("Sample Rate").parse().unwrap_or(0.0),
        duration: lookup("Duration")
            .parse()
            .unwrap_or(*times.last().unwrap_or(&0.0)),
        session: lookup("Session"),
        vehicle: lookup("Vehicle"),
        racer: lookup("Racer"),
        championship: lookup("Championship"),
        comment: lookup("Comment"),
        date: lookup("Date"),
        start_time: lookup("Time"),
        channel_names,
        channel_units: units,
        times,
        columns,
    })
}

#[cfg(test)]
mod tests {
    use super::{gridify, read_aim_csv, write_aim_csv, Gridded, GriddedChannel};
    use crate::{ChannelDType, ChannelMeta, ChannelSeries, ChannelSource, SessionMeta};

    #[test]
    fn sorts_and_dedupes_non_increasing_timestamps_keeping_last() {
        // RaceStudio 多设备交错导出：同一时刻出现两行、且顺序不递增
        let csv = "Format,AiM CSV File\n\
                   Session,S\n\
                   Vehicle,V\n\
                   Racer,R\n\
                   Championship,\n\
                   Comment,\n\
                   Date,D\n\
                   Time,10:00:00\n\
                   Sample Rate,10\n\
                   Duration,1\n\
                   \n\
                   Time,Speed\n\
                   s,km/h\n\
                   0.2,3\n\
                   0.1,1\n\
                   0.1,2\n\
                   0.3,4\n";
        let parsed = read_aim_csv(csv).expect("parse");
        assert_eq!(parsed.times, vec![0.1, 0.2, 0.3], "按时间排序后严格递增");
        assert_eq!(
            parsed.columns[0],
            vec![2.0, 3.0, 4.0],
            "同一时刻只保留最后一个样本"
        );
    }

    #[test]
    fn strips_utf8_bom_from_race_studio_export() {
        let csv = "\u{feff}Format,AiM CSV File\nSession,S\nTime,10:00:00\nSample Rate,10\nDuration,1\n\nTime,Speed\ns,km/h\n0.0,1\n0.1,2\n";
        let parsed = read_aim_csv(csv).expect("parse");
        assert_eq!(parsed.times, vec![0.0, 0.1]);
    }

    #[test]
    fn gridify_never_extends_past_real_samples_for_metadata_duration() {
        let meta = ChannelMeta {
            key: "Speed".into(),
            name: "Speed".into(),
            unit: "km/h".into(),
            source: ChannelSource::Csv,
            dtype: ChannelDType::Numeric,
            sample_rate_hz: 0.0,
        };
        let series = ChannelSeries {
            times: vec![0.0, 0.5, 1.0],
            values: vec![1.0, 2.0, 3.0],
        };
        let grid = gridify(10.0, &[(&meta, &series)]).unwrap();
        assert_eq!(grid.times.last().copied(), Some(1.0));
    }

    #[test]
    fn writes_time_and_duration_to_hundredths_without_extending_end() {
        let grid = Gridded {
            grid_hz: 100.0,
            times: vec![0.0, 59.861],
            channels: vec![GriddedChannel {
                name: "Speed".into(),
                unit: "km/h".into(),
                values: vec![1.0, 2.0],
            }],
        };
        let mut output = Vec::new();
        write_aim_csv(&mut output, &SessionMeta::default(), &grid, 0).unwrap();
        let csv = String::from_utf8(output).unwrap();
        assert!(csv.contains("\"Duration\",\"59.86\""));
        assert!(csv.contains("\"59.86\""));
        assert!(csv.contains("2.000000000"));
        assert!(!csv.contains("59.9"));
    }

    #[test]
    fn channel_grid_values_fills_nan_outside_native_range() {
        let times = vec![1.0, 2.0];
        let values = vec![10.0, 20.0];
        let grid = vec![0.0, 0.5, 1.0, 1.5, 2.0, 2.5];
        let out = super::channel_grid_values(&times, &values, &grid);
        assert!(out[0].is_nan());
        assert!(out[1].is_nan());
        assert_eq!(out[2], 10.0);
        assert_eq!(out[3], 10.0);
        assert_eq!(out[4], 20.0);
        assert!(out[5].is_nan());
    }
}
