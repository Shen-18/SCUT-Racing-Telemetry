//! 窗口统计命令实现（Rust 侧全分辨率计算，spec B.4-P5）。
//! 数据源 = raw 缓存；全程统计即 [0, duration]。

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
    let dataset = cache
        .dataset(hash)
        .map_err(|e| command_error("cache_error", e))?;
    let mut out = HashMap::with_capacity(channels.len());
    for key in channels {
        let stats = match dataset.read_raw(key) {
            Ok(series) => {
                let s = telemetry_core::channel_stats(&series, (start, end));
                if !s.min.is_finite() || !s.max.is_finite() || !s.mean.is_finite() {
                    continue;
                }
                ChannelStatsDto {
                    min: s.min,
                    max: s.max,
                    mean: s.mean,
                    std_dev: s.std,
                }
            }
            Err(cache_core::CacheError::UnknownChannel(_)) => continue,
            Err(error) => return Err(command_error("raw_missing", error)),
        };
        out.insert(key.clone(), stats);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cache_core::SourceIdentity;
    use telemetry_core::{ChannelDType, ChannelMeta, ChannelSeries, ChannelSource, SessionMeta};

    const HASH: &str = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    fn fixture(tag: &str) -> (CacheRoot, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("scut-stats-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        (CacheRoot::open(&root).unwrap(), root)
    }

    fn write_raw(cache: &CacheRoot) {
        cache.publish_metadata(
            SourceIdentity { hash: HASH.into(), mtime: 1, size: 1 },
            SessionMeta { duration: 2.0, ..Default::default() },
            vec![ChannelMeta {
                dtype: ChannelDType::Numeric,
                key: "Speed".into(), name: "Speed".into(), unit: "km/h".into(),
                source: ChannelSource::Csv, sample_rate_hz: 2.0,
            }],
            vec![],
        ).unwrap();
        cache.publish_raw(HASH, "Speed", &ChannelSeries {
            times: vec![0.0, 0.5, 1.0, 1.5, 2.0],
            values: vec![10.0, 20.0, 30.0, 40.0, 50.0],
        }).unwrap();
    }

    #[test]
    fn stats_over_full_session_and_missing_channel_is_nan() {
        let (cache, root) = fixture("full");
        write_raw(&cache);
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
        assert!(!out.contains_key("Ghost"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stats_over_window_slice_and_bad_hash_rejected() {
        let (cache, root) = fixture("slice");
        write_raw(&cache);
        let out = window_stats(&cache, HASH, &["Speed".to_string()], 0.5, 1.5).unwrap();
        assert_eq!(out.get("Speed").unwrap().min, 20.0);
        assert_eq!(out.get("Speed").unwrap().max, 40.0);
        assert!(window_stats(&cache, "bad", &["Speed".to_string()], 0.0, 1.0).is_err());
        std::fs::remove_dir_all(&root).ok();
    }
}
