//! csv-parser：SCUT 规范 CSV v1 读入（Step 6 的最小可用版，D17 提前落地）。
//!
//! 只解析 `telemetry_core::csv_io::write_aim_csv` 产出的规范格式（元数据块 +
//! 采样率块 + 通道/单位/数据行）；逗号分隔、引号字段、空单元格 = NaN。
//! Step 6 再补分号/制表符方言、GB18030 与欧式小数逗号，并挂 golden。
#![deny(unsafe_code)]

use std::collections::HashMap;
use std::path::Path;

use telemetry_core::csv_io;
use telemetry_core::{
    ChannelDType, ChannelMeta, ChannelSeries, ChannelSource, LapInfo, SessionMeta,
    TelemetryDataset, TelemetryError,
};

/// 解析一份规范 CSV 为遥测数据集（通道键 = 通道名，重名追加序号去重）。
pub fn parse_csv(path: &Path) -> Result<TelemetryDataset, TelemetryError> {
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes);
    let parsed = csv_io::read_aim_csv(&text)?;

    let meta = SessionMeta {
        file_path: path.to_path_buf(),
        file_type: "csv".into(),
        session: parsed.session,
        vehicle: parsed.vehicle,
        racer: parsed.racer,
        championship: parsed.championship,
        comment: parsed.comment,
        date: parsed.date,
        start_time: parsed.start_time,
        sample_rate_hz: parsed.sample_rate_hz as f32,
        duration: parsed.duration,
    };

    let mut channels: Vec<ChannelMeta> = Vec::with_capacity(parsed.channel_names.len());
    let mut series: HashMap<String, ChannelSeries> = HashMap::new();
    let mut used_names: HashMap<String, usize> = HashMap::new();
    for (index, name) in parsed.channel_names.iter().enumerate() {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let occurrence = used_names.entry(trimmed.to_lowercase()).or_insert(0);
        *occurrence += 1;
        let key = if *occurrence == 1 {
            trimmed.to_string()
        } else {
            format!("{trimmed} ({occurrence})")
        };
        channels.push(ChannelMeta {
            key: key.clone(),
            name: trimmed.to_string(),
            unit: parsed.channel_units[index].trim().to_string(),
            source: ChannelSource::Csv,
            dtype: ChannelDType::Numeric,
            sample_rate_hz: parsed.sample_rate_hz as f32,
        });
        series.insert(
            key,
            ChannelSeries {
                times: parsed.times.clone(),
                values: parsed.columns[index].clone(),
            },
        );
    }

    Ok(TelemetryDataset {
        meta,
        channels,
        series,
        laps: Vec::<LapInfo>::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use telemetry_core::csv_io::GriddedChannel;

    fn write_sample_csv(path: &Path) {
        let grid = csv_io::Gridded {
            grid_hz: 2.0,
            times: vec![0.0, 0.5, 1.0],
            channels: vec![
                GriddedChannel {
                    name: "GPS Speed".to_string(),
                    unit: "km/h".to_string(),
                    values: vec![10.0, 20.0, 30.0],
                },
                GriddedChannel {
                    name: "Gear".to_string(),
                    unit: String::new(),
                    values: vec![1.0, 1.0, 2.0],
                },
            ],
        };
        let meta = SessionMeta {
            file_path: path.to_path_buf(),
            file_type: "csv".into(),
            session: "Madring".into(),
            vehicle: "SCUT-24".into(),
            racer: "LIN".into(),
            championship: "FSAE".into(),
            comment: String::new(),
            date: "2026-09-15".into(),
            start_time: "10:00:00".into(),
            sample_rate_hz: 2.0,
            duration: 1.0,
        };
        let mut buffer = Vec::new();
        csv_io::write_aim_csv(&mut buffer, &meta, &grid, 2).unwrap();
        std::fs::write(path, buffer).unwrap();
    }

    #[test]
    fn parses_written_csv_into_dataset_with_unique_keys() {
        let dir = std::env::temp_dir().join(format!("scut-csv-parser-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.csv");
        write_sample_csv(&path);

        let dataset = parse_csv(&path).unwrap();
        assert_eq!(dataset.meta.file_type, "csv");
        assert_eq!(dataset.meta.session, "Madring");
        assert_eq!(dataset.meta.sample_rate_hz, 2.0);
        assert!((dataset.meta.duration - 1.0).abs() < 1e-9);
        assert_eq!(dataset.channels.len(), 2);
        assert_eq!(dataset.channels[0].name, "GPS Speed");
        assert_eq!(dataset.channels[0].unit, "km/h");
        assert!(matches!(dataset.channels[0].source, ChannelSource::Csv));
        let speed = dataset.channel("GPS Speed").unwrap();
        assert_eq!(speed.values, vec![10.0, 20.0, 30.0]);
        assert_eq!(speed.times, vec![0.0, 0.5, 1.0]);
        assert!(dataset.laps.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_garbage_files_without_panicking() {
        let dir = std::env::temp_dir().join(format!("scut-csv-parser-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bad.csv");
        std::fs::write(&path, "not,a,telemetry,file\n1,2,3\n").unwrap();
        assert!(parse_csv(&path).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
