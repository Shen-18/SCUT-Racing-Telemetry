//! 导出四件套（2026-09-16 负责人需求）：
//! 1. 单条导出 / 2. 多选导出 / 3. 当日导出 —— 库页，从 raw 缓存重建规范 CSV；
//! 4. 选中通道导出 —— 分析页，从 raw 缓存抽取勾选通道列重新生成规范 CSV。

use crate::state::{command_error, CommandResult};
use cache_core::CacheRoot;
use std::path::{Path, PathBuf};
use telemetry_core::ChannelSeries;
use telemetry_ipc::ExportOutcome;

fn io_err(error: std::io::Error) -> telemetry_ipc::CmdError {
    command_error("io_error", error)
}

fn base_name(file_name: &str) -> String {
    file_name
        .rsplit_once('.')
        .map(|(base, _)| base)
        .unwrap_or(file_name)
        .to_string()
}

fn record_source_name(file_path: &std::path::Path) -> String {
    file_path
        .to_string_lossy()
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or("record")
        .to_string()
}

fn infer_grid_hz(times: &[f64]) -> f64 {
    let mut diffs: Vec<f64> = times
        .windows(2)
        .filter_map(|pair| {
            let diff = pair[1] - pair[0];
            (diff.is_finite() && diff > 0.0).then_some(diff)
        })
        .collect();
    if diffs.is_empty() {
        return 1.0;
    }
    diffs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    (1.0 / diffs[diffs.len() / 2]).clamp(1.0, 500.0)
}

/// Reconstructs a CSV grid from exact raw samples without resampling.
pub fn raw_grid(
    dataset: &cache_core::DatasetCache,
    channels: &[String],
    start: f64,
    end: f64,
) -> CommandResult<telemetry_core::csv_io::Gridded> {
    if channels.is_empty() {
        return Err(command_error("no_channels_selected", "记录没有可导出的数值通道"));
    }
    let mut selected: Vec<(&cache_core::CachedChannelMeta, ChannelSeries)> = Vec::new();
    for key in channels {
        let entry = dataset
            .manifest()
            .channels
            .iter()
            .find(|entry| entry.meta.key == *key)
            .ok_or_else(|| command_error("channel_not_found", key))?;
        let series = dataset
            .read_raw(key)
            .map_err(|error| command_error("raw_missing", error))?;
        selected.push((&entry.meta, series));
    }
    let mut events: Vec<(f64, usize, f32)> = Vec::new();
    for (channel_index, (_, series)) in selected.iter().enumerate() {
        for (&time, &value) in series.times.iter().zip(&series.values) {
            if time.is_finite() && time >= start - 1e-9 && time <= end + 1e-9 {
                events.push((time, channel_index, value));
            }
        }
    }
    if events.is_empty() {
        return Err(command_error("empty_range", "所选时间范围内没有真实数据点"));
    }
    events.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut times = Vec::new();
    let mut values = vec![Vec::new(); selected.len()];
    let mut index = 0usize;
    while index < events.len() {
        let time = events[index].0;
        let row_start = index;
        while index < events.len() && (events[index].0 - time).abs() <= 1e-9 {
            index += 1;
        }
        times.push(time);
        for channel in &mut values {
            channel.push(f32::NAN);
        }
        for (_, channel_index, value) in &events[row_start..index] {
            values[*channel_index].last_mut().map(|slot| *slot = *value);
        }
    }
    let gridded_channels = selected
        .iter()
        .enumerate()
        .map(|(channel_index, (meta, _))| telemetry_core::csv_io::GriddedChannel {
            name: meta.name.clone(),
            unit: meta.unit.clone(),
            values: std::mem::take(&mut values[channel_index]),
        })
        .collect();
    Ok(telemetry_core::csv_io::Gridded {
        grid_hz: infer_grid_hz(&times),
        times,
        channels: gridded_channels,
    })
}

/// 同批重名时追加纳秒十六进制防撞。
fn pick_destination(
    dir: &Path,
    wanted: &str,
    taken: &mut std::collections::HashSet<String>,
) -> PathBuf {
    let candidate = if taken.insert(wanted.to_string()) {
        wanted.to_string()
    } else {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        format!("{wanted}_{nanos:08x}")
    };
    dir.join(format!("{candidate}.csv"))
}

/// 批量导出记录的 raw 缓存到目标目录（单条/多选/当日共用）。
pub fn export_records(
    cache: &CacheRoot,
    hashes: &[String],
    out_dir: &Path,
) -> CommandResult<Vec<ExportOutcome>> {
    if !out_dir.is_dir() {
        return Err(command_error(
            "invalid_export_dir",
            format!("导出目录不存在: {}", out_dir.display()),
        ));
    }
    let mut taken = std::collections::HashSet::new();
    let mut outcomes = Vec::with_capacity(hashes.len());
    for hash in hashes {
        // hash 直接拼路径，必须先校验为 64 位 hex（与 purge_hash 同一约束）
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name: String::new(),
                status: "failed".into(),
                path: None,
                message: Some("非法记录标识".into()),
            });
            continue;
        }
        let dataset = match cache.dataset(hash) {
            Ok(dataset) => dataset,
            Err(_) => {
                outcomes.push(ExportOutcome {
                    file_hash: hash.clone(),
                    file_name: String::new(),
                    status: "failed".into(),
                    path: None,
                    message: Some("记录不存在或缓存损坏".into()),
                });
                continue;
            }
        };
        let file_name = record_source_name(&dataset.manifest().meta.file_path);
        let dest = pick_destination(out_dir, &base_name(&file_name), &mut taken);
        let channels: Vec<String> = dataset
            .manifest()
            .channels
            .iter()
            .map(|entry| entry.meta.key.clone())
            .collect();
        match raw_grid(&dataset, &channels, f64::NEG_INFINITY, f64::INFINITY)
            .and_then(|grid| {
                let mut buffer = Vec::new();
                telemetry_core::csv_io::write_aim_csv(
                    &mut buffer,
                    &dataset.manifest().meta,
                    &grid,
                    dataset.manifest().laps.len(),
                )
                .map_err(|error| command_error("csv_error", error))?;
                std::fs::write(&dest, buffer).map_err(io_err)
            }) {
            Ok(()) => outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name,
                status: "exported".into(),
                path: Some(dest.display().to_string()),
                message: None,
            }),
            Err(error) => outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name,
                status: "missing".into(),
                path: None,
                message: Some(format!("无法从 raw 缓存导出，请重新导入：{}", error.message)),
            }),
        }
    }
    Ok(outcomes)
}

/// 选中通道导出：从 raw 缓存抽取勾选通道（时间范围 [start,end]），
/// 按用户勾选顺序重新生成规范 CSV，不重采样。
pub fn export_channels(
    cache: &CacheRoot,
    hash: &str,
    channels: &[String],
    start: f64,
    end: f64,
    out_path: &Path,
) -> CommandResult<()> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(command_error("invalid_hash", hash));
    }
    if channels.is_empty() {
        return Err(command_error(
            "no_channels_selected",
            "请先勾选要导出的通道",
        ));
    }
    let dataset = cache.dataset(hash).map_err(|error| command_error("dataset_missing", error))?;
    let known: std::collections::HashSet<&str> = dataset
        .manifest()
        .channels
        .iter()
        .map(|entry| entry.meta.key.as_str())
        .collect();
    if channels.iter().all(|key| !known.contains(key.as_str())) {
        return Err(command_error(
            "no_channels_selected",
            format!("勾选的通道在记录中不存在: {}", channels.join("、")),
        ));
    }
    let grid = raw_grid(&dataset, channels, start, end)?;
    let mut buffer = Vec::new();
    telemetry_core::csv_io::write_aim_csv(&mut buffer, &dataset.manifest().meta, &grid, 0)
        .map_err(|e| command_error("csv_error", e))?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    std::fs::write(out_path, buffer).map_err(io_err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HASH_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const HASH_C: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    fn write_record(root: &Path, hash: &str, original_name: &str) {
        let dataset_dir = root.join("datasets").join(hash);
        std::fs::create_dir_all(&dataset_dir).unwrap();
        use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource, SessionMeta};
        let make_channel = |key: &str, name: &str, unit: &str| ChannelMeta {
            key: key.into(),
            name: name.into(),
            unit: unit.into(),
            source: ChannelSource::Csv,
            dtype: ChannelDType::Numeric,
            sample_rate_hz: 0.0,
        };
        let speed = make_channel("Speed", "Speed", "km/h");
        let rpm = make_channel("RPM", "RPM", "rpm");
        let times = vec![0.0, 0.5, 1.0, 1.5, 2.0];
        let session = SessionMeta {
            file_path: std::path::PathBuf::from(format!("D:\\Data\\{original_name}")),
            file_type: "xrk".into(),
            session: "FP2".into(),
            vehicle: "SCUT-24".into(),
            racer: "LIN".into(),
            championship: String::new(),
            comment: String::new(),
            date: "2026-09-15".into(),
            start_time: "14:00:00".into(),
            sample_rate_hz: 2.0,
            duration: 2.0,
        };
        let cache = cache_core::CacheRoot::open(root).unwrap();
        cache
            .publish_metadata(
                cache_core::SourceIdentity {
                    hash: hash.into(),
                    mtime: 100,
                    size: 1,
                },
                session,
                vec![speed, rpm],
                Vec::new(),
            )
            .unwrap();
        cache
            .publish_raw(
                hash,
                "Speed",
                &telemetry_core::ChannelSeries {
                    times: times.clone(),
                    values: vec![10.0, 20.0, 30.0, 40.0, 50.0],
                },
            )
            .unwrap();
        cache
            .publish_raw(
                hash,
                "RPM",
                &telemetry_core::ChannelSeries {
                    times,
                    values: vec![1000.0, 2000.0, 3000.0, 4000.0, 5000.0],
                },
            )
            .unwrap();
    }

    /// 旧版（D17 之前）导入记录：有 manifest、无 source.csv → 导出应判 missing。
    fn write_manifest_only(root: &Path, hash: &str, original_name: &str) {
        let dataset_dir = root.join("datasets").join(hash);
        std::fs::create_dir_all(&dataset_dir).unwrap();
        let json = format!(
            r#"{{"version":1,"identity":{{"hash":"{hash}","mtime":100,"size":1}},"meta":{{"file_path":"D:\\Data\\{original_name}","file_type":"xrk","session":"FP2","vehicle":"SCUT-24","racer":"LIN","championship":"","comment":"","date":"2026-09-15","start_time":"14:00:00","sample_rate_hz":2.0,"duration":2.0}},"channels":[],"laps":[],"state":"Ready","error":null}}"#
        );
        std::fs::write(dataset_dir.join("manifest.json"), json).unwrap();
    }

    fn fixture(tag: &str) -> (cache_core::CacheRoot, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("scut-export-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        (cache_core::CacheRoot::open(&root).unwrap(), root)
    }

    #[test]
    fn export_records_copies_renames_and_reports_missing() {
        let (cache, root) = fixture("rec");
        write_record(&root, HASH_A, "SCUT_FP2.xrk");
        write_record(&root, HASH_B, "SCUT_FP2.xrk"); // 与 A 同名 → 防撞
        write_manifest_only(&root, HASH_C, "old_import.xrk");
        let out_dir = root.join("out");
        std::fs::create_dir_all(&out_dir).unwrap();

        let records = [HASH_A.to_string(), HASH_B.to_string(), HASH_C.to_string()];
        let outcomes = export_records(&cache, &records, &out_dir).unwrap();
        assert_eq!(outcomes.len(), 3);
        assert_eq!(outcomes[0].status, "exported");
        assert_eq!(outcomes[0].file_name, "SCUT_FP2.xrk");
        assert!(outcomes[0].path.as_ref().unwrap().ends_with("SCUT_FP2.csv"));
        assert_eq!(outcomes[1].status, "exported");
        assert_ne!(outcomes[0].path, outcomes[1].path, "重名记录导出文件不互撞");
        assert_eq!(outcomes[2].status, "missing");
        assert!(outcomes[2].message.as_ref().unwrap().contains("重新导入"));
        assert_eq!(out_dir.read_dir().unwrap().count(), 2);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn export_channels_writes_selected_columns_in_order_over_range() {
        let (cache, root) = fixture("ch");
        write_record(&root, HASH_A, "SCUT_FP2.xrk");
        let out_path = root.join("out").join("selected.csv");
        export_channels(
            &cache,
            HASH_A,
            &["RPM".to_string(), "Speed".to_string()],
            0.5,
            1.5,
            &out_path,
        )
        .unwrap();
        let parsed = csv_parser::parse_csv(&out_path).unwrap();
        assert_eq!(parsed.channels.len(), 2);
        assert_eq!(parsed.channels[0].key, "RPM", "按用户勾选顺序输出");
        assert_eq!(parsed.channels[1].key, "Speed");
        let rpm = parsed.series.get("RPM").unwrap();
        assert_eq!(rpm.times, vec![0.5, 1.0, 1.5], "区间 [0.5, 1.5] 含端点");
        assert_eq!(rpm.values, vec![2000.0, 3000.0, 4000.0]);
        let speed = parsed.series.get("Speed").unwrap();
        assert_eq!(speed.values, vec![20.0, 30.0, 40.0]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn raw_grid_does_not_hold_shorter_channels_after_their_last_sample() {
        let (cache, root) = fixture("native-end");
        use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource, SessionMeta};
        let hash = "d".repeat(64);
        cache
            .publish_metadata(
                cache_core::SourceIdentity {
                    hash: hash.clone(),
                    mtime: 1,
                    size: 1,
                },
                SessionMeta::default(),
                vec![
                    ChannelMeta {
                        dtype: ChannelDType::Numeric,
                        key: "Speed".into(),
                        name: "Speed".into(),
                        unit: "km/h".into(),
                        source: ChannelSource::Csv,
                        sample_rate_hz: 2.0,
                    },
                    ChannelMeta {
                        dtype: ChannelDType::Numeric,
                        key: "GPS".into(),
                        name: "GPS".into(),
                        unit: "m".into(),
                        source: ChannelSource::Gps,
                        sample_rate_hz: 2.0,
                    },
                ],
                vec![],
            )
            .unwrap();
        cache
            .publish_raw(
                &hash,
                "Speed",
                &telemetry_core::ChannelSeries {
                    times: vec![0.0, 0.5, 1.0],
                    values: vec![1.0, 2.0, 3.0],
                },
            )
            .unwrap();
        cache
            .publish_raw(
                &hash,
                "GPS",
                &telemetry_core::ChannelSeries {
                    times: vec![0.0, 0.5, 1.0, 1.5],
                    values: vec![10.0, 20.0, 30.0, 40.0],
                },
            )
            .unwrap();
        let dataset = cache.dataset(&hash).unwrap();
        let grid = raw_grid(&dataset, &["Speed".into(), "GPS".into()], 0.0, 2.0).unwrap();
        assert_eq!(grid.times, vec![0.0, 0.5, 1.0, 1.5]);
        assert_eq!(grid.channels[0].values[..3], [1.0, 2.0, 3.0]);
        assert!(grid.channels[0].values[3].is_nan());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn export_channels_rejects_unknown_channels_and_bad_hash() {
        let (cache, root) = fixture("bad");
        write_record(&root, HASH_A, "SCUT_FP2.xrk");
        let out_path = root.join("x.csv");
        let err = export_channels(&cache, HASH_A, &["Nope".to_string()], 0.0, 2.0, &out_path)
            .unwrap_err();
        assert_eq!(err.code, "no_channels_selected");
        let err = export_channels(&cache, "short", &["Speed".to_string()], 0.0, 2.0, &out_path)
            .unwrap_err();
        assert_eq!(err.code, "invalid_hash");
        std::fs::remove_dir_all(&root).ok();
    }
}
