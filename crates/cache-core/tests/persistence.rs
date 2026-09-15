use cache_core::{CacheRoot, CacheState, SourceIdentity};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use telemetry_core::{ChannelDType, ChannelMeta, ChannelSource, SessionMeta};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Disk(PathBuf);
impl Disk {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "cache-core-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn source(&self) -> SourceIdentity {
        let p = self.0.join("source.csv");
        fs::write(&p, b"time,speed\n0,4\n1,9\n2,-3\n3,7\n4,2\n").unwrap();
        SourceIdentity::from_path(&p).unwrap()
    }
}
impl Drop for Disk {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn channel(key: &str) -> ChannelMeta {
    ChannelMeta {
        dtype: ChannelDType::Numeric,
        key: key.into(),
        name: key.into(),
        unit: "km/h".into(),
        source: ChannelSource::Csv,
        sample_rate_hz: 1.0,
    }
}

#[test]
fn metadata_is_persistent_before_any_channel_data_exists() {
    let disk = Disk::new();
    let identity = disk.source();
    let path = disk.0.join("cache");
    let root = CacheRoot::open(&path).unwrap();
    root.publish_metadata(
        identity.clone(),
        SessionMeta::default(),
        vec![channel("Speed"), channel("../CON:速度")],
        vec![],
    )
    .unwrap();
    drop(root);
    let cache = CacheRoot::open(&path)
        .unwrap()
        .dataset(&identity.hash)
        .unwrap();
    assert_eq!(cache.manifest().state, CacheState::MetadataReady);
    assert_eq!(cache.manifest().channels[1].meta.key, "../CON:速度");
    assert_eq!(cache.manifest().identity.hash, identity.hash);
    assert!(matches!(
        cache.read_window_frame("Speed", 0., 4., 100, 7),
        Err(cache_core::CacheError::ChannelBuilding(_))
    ));
}

#[test]
fn raw_publication_survives_cancellation_and_can_resume_in_a_new_root() {
    let disk = Disk::new();
    let identity = disk.source();
    let path = disk.0.join("cache");
    let root = CacheRoot::open(&path).unwrap();
    root.publish_metadata(
        identity.clone(),
        SessionMeta::default(),
        vec![channel("Speed"), channel("RPM")],
        vec![],
    )
    .unwrap();
    let samples = telemetry_core::ChannelSeries {
        times: vec![0., 1., 2., 3., 4.],
        values: vec![4., 9., -3., 7., 2.],
    };
    root.publish_raw(&identity.hash, "Speed", &samples).unwrap();
    drop(root); // Cancellation drops worker state, not already published files.
    let root = CacheRoot::open(&path).unwrap();
    let cache = root.dataset(&identity.hash).unwrap();
    assert_eq!(cache.manifest().state, CacheState::RawPartial);
    assert_eq!(
        cache.read_cursor_values(&["Speed".into()], 2.5).unwrap(),
        vec![-3.]
    );
    assert!(matches!(
        cache.read_cursor_values(&["RPM".into()], 2.),
        Err(cache_core::CacheError::ChannelBuilding(_))
    ));
    assert!(matches!(
        cache.read_window_frame("Speed", 0., 4., 1, 9),
        Err(cache_core::CacheError::ChannelBuilding(_))
    ));
}

fn decode(bytes: &[u8]) -> (serde_json::Value, Vec<f64>, Vec<f32>, Vec<f32>) {
    assert_eq!(&bytes[..4], b"SXK1");
    let hlen = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let header: serde_json::Value = serde_json::from_slice(&bytes[8..8 + hlen]).unwrap();
    let n = header["buckets"].as_u64().unwrap() as usize;
    let payload = &bytes[8 + hlen..];
    assert_eq!(payload.len(), n * 16);
    let times = payload[..n * 8]
        .as_chunks::<8>()
        .0
        .iter()
        .map(|b| f64::from_le_bytes(*b))
        .collect();
    let mins = payload[n * 8..n * 12]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let maxs = payload[n * 12..]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    (header, times, mins, maxs)
}

#[test]
fn precomputed_frames_survive_reopen_without_raw_or_source_and_echo_generation() {
    let disk = Disk::new();
    let identity = disk.source();
    let path = disk.0.join("cache");
    let root = CacheRoot::open(&path).unwrap();
    let mut cache = root
        .publish_metadata(
            identity.clone(),
            SessionMeta::default(),
            vec![channel("Speed"), channel("RPM")],
            vec![],
        )
        .unwrap();
    cache
        .write_raw(
            "Speed",
            &telemetry_core::ChannelSeries {
                times: vec![0., 1., 2., 3., 4.],
                values: vec![4., 9., -3., 7., 2.],
            },
        )
        .unwrap();
    cache.build_pyramid("Speed").unwrap();
    assert_eq!(cache.manifest().state, CacheState::PyramidPartial);
    assert!(cache.mark_ready().is_err());
    let checksum = cache.manifest().channels[0]
        .raw
        .as_ref()
        .unwrap()
        .checksum
        .clone();
    fs::remove_file(
        path.join("datasets")
            .join(&identity.hash)
            .join("channels")
            .join(format!("{checksum}.raw")),
    )
    .unwrap();
    fs::remove_file(disk.0.join("source.csv")).unwrap();
    drop(cache);
    drop(root);
    let cache = CacheRoot::open(&path)
        .unwrap()
        .dataset(&identity.hash)
        .unwrap();
    let (header, times, mins, maxs) = decode(
        &cache
            .read_window_frame("Speed", 0., 4., 2, u64::MAX)
            .unwrap(),
    );
    assert_eq!(header["generation"].as_u64(), Some(u64::MAX));
    assert_eq!(header["full_count"], 5);
    assert_eq!(header["unit"], "km/h");
    assert_eq!(times, vec![0., 2., 4.]);
    assert_eq!(mins, vec![4., -3., 2.]);
    assert_eq!(maxs, vec![9., 7., 2.]);
    assert!(matches!(
        cache.read_window_frame("RPM", 0., 4., 2, 1),
        Err(cache_core::CacheError::ChannelBuilding(_))
    ));
}

#[test]
fn overview_and_failed_job_leave_published_channels_usable_and_resume() {
    let disk = Disk::new();
    let identity = disk.source();
    let root = CacheRoot::open(&disk.0.join("cache")).unwrap();
    let mut cache = root
        .publish_metadata(
            identity.clone(),
            SessionMeta::default(),
            vec![channel("Speed")],
            vec![],
        )
        .unwrap();
    let samples = telemetry_core::ChannelSeries {
        times: (0..2051).map(f64::from).collect(),
        values: (0..2051)
            .map(|i| if i == 1025 { 9999. } else { 2. })
            .collect(),
    };
    cache.build_overview("Speed", &samples).unwrap();
    assert_eq!(cache.manifest().state, CacheState::PyramidPartial);
    assert_eq!(
        cache.manifest().channels[0]
            .pyramid
            .as_ref()
            .unwrap()
            .levels
            .len(),
        1
    );
    assert!(
        !cache.manifest().channels[0]
            .pyramid
            .as_ref()
            .unwrap()
            .complete
    );
    cache.mark_failed("actor stopped").unwrap();
    let mut cache = root.dataset(&identity.hash).unwrap();
    assert_eq!(cache.manifest().state, CacheState::Failed);
    assert_eq!(cache.manifest().error.as_deref(), Some("actor stopped"));
    let (_, times, _, maxs) = decode(&cache.read_window_frame("Speed", 0., 2050., 256, 1).unwrap());
    assert_eq!(times.len(), 257);
    assert_eq!(maxs[128], 9999.);
    cache.build_pyramid("Speed").unwrap();
    cache.mark_ready().unwrap();
    assert_eq!(cache.manifest().state, CacheState::Ready);
    assert_eq!(
        cache.manifest().channels[0]
            .pyramid
            .as_ref()
            .unwrap()
            .levels
            .len(),
        3
    );
    assert!(cache.manifest().error.is_none());
}
