//! 导出四件套（2026-09-16 负责人需求）：
//! 1. 单条导出 / 2. 多选导出 / 3. 当日导出 —— 库页，本质是把库内 `source.csv`
//!    复制到用户目录（D17 后库内记录即规范 CSV，零转换）；
//! 4. 选中通道导出 —— 分析页，从 source.csv 抽取勾选通道列重新生成规范 CSV。
//!
//! 旧版（D17 之前）导入的记录没有 source.csv，导出返回 missing 并提示重新导入。

use crate::state::{command_error, CommandResult};
use cache_core::CacheRoot;
use std::path::{Path, PathBuf};
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

/// 批量导出记录的库内 source.csv 到目标目录（单条/多选/当日共用）。
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
        let source = cache.path().join("datasets").join(hash).join("source.csv");
        if !source.exists() {
            outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name,
                status: "missing".into(),
                path: None,
                message: Some("该记录为旧版导入（无库内 CSV），请重新导入后再导出".into()),
            });
            continue;
        }
        let dest = pick_destination(out_dir, &base_name(&file_name), &mut taken);
        match std::fs::copy(&source, &dest) {
            Ok(_) => outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name,
                status: "exported".into(),
                path: Some(dest.display().to_string()),
                message: None,
            }),
            Err(error) => outcomes.push(ExportOutcome {
                file_hash: hash.clone(),
                file_name,
                status: "failed".into(),
                path: None,
                message: Some(format!("复制失败: {error}")),
            }),
        }
    }
    Ok(outcomes)
}

/// 选中通道导出：从库内 source.csv 抽取勾选通道（时间范围 [start,end]），
/// 按用户勾选顺序重新生成规范 CSV。数据保持库内统一网格，不重采样。
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
    let source = cache.path().join("datasets").join(hash).join("source.csv");
    if !source.exists() {
        return Err(command_error(
            "source_missing",
            "该记录为旧版导入（无库内 CSV），请重新导入后再导出",
        ));
    }
    let parsed = csv_parser::parse_csv(&source).map_err(|e| command_error("csv_error", e))?;
    let mut selected: Vec<(&telemetry_core::ChannelMeta, &telemetry_core::ChannelSeries)> =
        Vec::with_capacity(channels.len());
    let mut missing: Vec<String> = Vec::new();
    for wanted in channels {
        match parsed.channels.iter().find(|c| &c.key == wanted) {
            Some(meta) => {
                let series = parsed
                    .series
                    .get(&meta.key)
                    .expect("csv_parser builds a series for every channel");
                selected.push((meta, series));
            }
            None => missing.push(wanted.clone()),
        }
    }
    if selected.is_empty() {
        return Err(command_error(
            "no_channels_selected",
            format!("勾选的通道在记录中不存在: {}", missing.join("、")),
        ));
    }
    // 全部列共享同一网格时间轴（csv_parser 的构造保证）
    let times: Vec<f64> = selected[0].1.times.clone();
    let grid_hz = if parsed.meta.sample_rate_hz > 0.0 {
        parsed.meta.sample_rate_hz as f64
    } else {
        1.0
    };
    let mut kept_times: Vec<f64> = Vec::new();
    let mut kept_values: Vec<Vec<f32>> = vec![Vec::new(); selected.len()];
    for (row_index, t) in times.iter().enumerate() {
        let t = *t;
        if t < start - 1e-9 || t > end + 1e-9 {
            continue;
        }
        kept_times.push(t);
        for (position, (_, series)) in selected.iter().enumerate() {
            kept_values[position].push(series.values.get(row_index).copied().unwrap_or(f32::NAN));
        }
    }
    if kept_times.is_empty() {
        return Err(command_error("empty_range", "所选时间范围内没有数据行"));
    }
    let grid = telemetry_core::csv_io::Gridded {
        grid_hz,
        times: kept_times,
        channels: selected
            .iter()
            .enumerate()
            .map(
                |(position, (meta, _))| telemetry_core::csv_io::GriddedChannel {
                    name: meta.name.clone(),
                    unit: meta.unit.clone(),
                    values: std::mem::take(&mut kept_values[position]),
                },
            )
            .collect(),
    };
    let mut buffer = Vec::new();
    telemetry_core::csv_io::write_aim_csv(&mut buffer, &parsed.meta, &grid, 0)
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
        use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource};
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
        let grid = telemetry_core::csv_io::Gridded {
            grid_hz: 2.0,
            times: times.clone(),
            channels: vec![
                telemetry_core::csv_io::GriddedChannel {
                    name: "Speed".into(),
                    unit: "km/h".into(),
                    values: vec![10.0, 20.0, 30.0, 40.0, 50.0],
                },
                telemetry_core::csv_io::GriddedChannel {
                    name: "RPM".into(),
                    unit: "rpm".into(),
                    values: vec![1000.0, 2000.0, 3000.0, 4000.0, 5000.0],
                },
            ],
        };
        let meta = telemetry_core::SessionMeta {
            file_path: std::path::PathBuf::from(format!("D:\\Data\\{original_name}")),
            file_type: "csv".into(),
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
        let mut buffer = Vec::new();
        telemetry_core::csv_io::write_aim_csv(&mut buffer, &meta, &grid, 1).unwrap();
        std::fs::write(dataset_dir.join("source.csv"), buffer).unwrap();
        let json = format!(
            r#"{{"version":1,"identity":{{"hash":"{hash}","mtime":100,"size":1}},"meta":{{"file_path":"D:\\Data\\{original_name}","file_type":"csv","session":"FP2","vehicle":"SCUT-24","racer":"LIN","championship":"","comment":"","date":"2026-09-15","start_time":"14:00:00","sample_rate_hz":2.0,"duration":2.0}},"channels":[],"laps":[],"state":"Ready","error":null}}"#
        );
        std::fs::write(dataset_dir.join("manifest.json"), json).unwrap();
        let _ = (speed, rpm, times);
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
