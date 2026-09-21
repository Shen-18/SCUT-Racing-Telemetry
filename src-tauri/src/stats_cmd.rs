//! 窗口统计命令实现（Rust 侧全分辨率计算，spec B.4-P5）。
//! 数据源 = 库内 source.csv（D17 统一网格）；全程统计即 [0, duration]。

use crate::state::{command_error, CommandResult};
use cache_core::CacheRoot;
use std::collections::HashMap;
use telemetry_ipc::ChannelStatsDto;

pub fn window_stats(
    cache: &CacheRoot,
    hash: &str,
    channels: &[String],
    start: f64,
    end: f64,
) -> CommandResult<HashMap<String, ChannelStatsDto>> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(command_error("invalid_hash", hash));
    }
    let source = cache.path().join("datasets").join(hash).join("source.csv");
    if !source.exists() {
        return Err(command_error(
            "source_missing",
            "该记录为旧版导入（无库内 CSV），请重新导入后再导出",
        ));
    }
    let parsed = csv_parser::parse_csv(&source).map_err(|e| command_error("csv_error", e))?;
    let mut out = HashMap::with_capacity(channels.len());
    for key in channels {
        let stats = match parsed.series.get(key) {
            Some(series) => {
                let s = telemetry_core::channel_stats(series, (start, end));
                ChannelStatsDto {
                    min: s.min,
                    max: s.max,
                    mean: s.mean,
                    std_dev: s.std,
                }
            }
            None => ChannelStatsDto {
                min: f32::NAN,
                max: f32::NAN,
                mean: f64::NAN,
                std_dev: f64::NAN,
            },
        };
        out.insert(key.clone(), stats);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const HASH: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    fn fixture(tag: &str) -> (CacheRoot, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("scut-stats-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        (CacheRoot::open(&root).unwrap(), root)
    }

    fn write_source(root: &Path) {
        use telemetry_core::csv_io::{Gridded, GriddedChannel};
        let dataset_dir = root.join("datasets").join(HASH);
        std::fs::create_dir_all(&dataset_dir).unwrap();
        let grid = Gridded {
            grid_hz: 2.0,
            times: vec![0.0, 0.5, 1.0, 1.5, 2.0],
            channels: vec![GriddedChannel {
                name: "Speed".into(),
                unit: "km/h".into(),
                values: vec![10.0, 20.0, 30.0, 40.0, 50.0],
            }],
        };
        let meta = telemetry_core::SessionMeta {
            file_path: root.join("S.csv"),
            file_type: "csv".into(),
            session: "S".into(),
            vehicle: "V".into(),
            racer: "R".into(),
            championship: String::new(),
            comment: String::new(),
            date: "2026-09-16".into(),
            start_time: "10:00:00".into(),
            sample_rate_hz: 2.0,
            duration: 2.0,
        };
        let mut buffer = Vec::new();
        telemetry_core::csv_io::write_aim_csv(&mut buffer, &meta, &grid, 0).unwrap();
        std::fs::write(dataset_dir.join("source.csv"), buffer).unwrap();
    }

    #[test]
    fn stats_over_full_session_and_missing_channel_is_nan() {
        let (cache, root) = fixture("full");
        write_source(&root);
        let out = window_stats(
            &cache,
            HASH,
            &["Speed".to_string(), "Ghost".to_string()],
            0.0,
            2.0,
        )
        .unwrap();
        let speed = out.get("Speed").unwrap();
        assert_eq!(speed.min, 10.0);
        assert_eq!(speed.max, 50.0);
        assert!((speed.mean - 30.0).abs() < 1e-9);
        let ghost = out.get("Ghost").unwrap();
        assert!(ghost.min.is_nan());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stats_over_window_slice_and_bad_hash_rejected() {
        let (cache, root) = fixture("slice");
        write_source(&root);
        let out = window_stats(&cache, HASH, &["Speed".to_string()], 0.5, 1.5).unwrap();
        assert_eq!(out.get("Speed").unwrap().min, 20.0);
        assert_eq!(out.get("Speed").unwrap().max, 40.0);
        assert!(window_stats(&cache, "bad", &["Speed".to_string()], 0.0, 1.0).is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
