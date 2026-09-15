use aim_ffi::AimActor;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    task::{Context, Poll, RawWaker, RawWakerVTable, Waker},
};
fn block_on<F: std::future::Future>(mut f: F) -> F::Output {
    fn no(_: *const ()) {}
    fn clone(p: *const ()) -> RawWaker {
        RawWaker::new(p, &VT)
    }
    static VT: RawWakerVTable = RawWakerVTable::new(clone, no, no, no);
    let w = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VT)) };
    let mut cx = Context::from_waker(&w);
    let mut f = unsafe { std::pin::Pin::new_unchecked(&mut f) };
    loop {
        if let Poll::Ready(x) = f.as_mut().poll(&mut cx) {
            return x;
        }
        std::thread::yield_now();
    }
}
fn lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
fn paths() -> (PathBuf, PathBuf) {
    (
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..\\..\\TestMatLabXRK\\DLL-2022\\MatLabXRK-2022-64-ReleaseU.dll"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..\\..\\Data\\AGX.xrk"),
    )
}
#[test]
fn opens_agx() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let a = AimActor::spawn(&dll).unwrap();
    let d = block_on(a.open_xrk(xrk)).unwrap();
    assert!(!d.channels.is_empty());
    assert!(d.channels.iter().any(|c| {
        c.name == "GPS Speed (AiM Interpolated)" && c.source == telemetry_core::ChannelSource::Gps
    }));
    assert!(d.channels.iter().any(|c| {
        c.name == "GPS Speed" && c.source == telemetry_core::ChannelSource::DerivedGps
    }));
    assert!(!d.laps.is_empty());
    assert!(d.meta.duration > 0.0);
    assert!(!d.meta.date.is_empty());
    assert!(!d.meta.start_time.is_empty());
}

#[test]
fn metadata_first_and_each_selected_agx_channel_match_full_import() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let actor = AimActor::spawn(&dll).unwrap();
    let metadata = block_on(actor.metadata(xrk.clone())).unwrap();
    assert!(!metadata.channels.is_empty());
    assert!(metadata.meta.duration > 0.0);
    assert!(!metadata.laps.is_empty());
    let full = block_on(actor.open_xrk(xrk.clone())).unwrap();
    assert_eq!(metadata.meta.date, full.meta.date);
    assert_eq!(metadata.meta.duration, full.meta.duration);
    assert_eq!(metadata.channels.len(), full.channels.len());
    for (header, expected) in metadata.channels.iter().zip(&full.channels) {
        assert_eq!(header.key, expected.key);
        assert_eq!(header.name, expected.name);
        assert_eq!(header.unit, expected.unit);
        assert_eq!(header.source, expected.source);
        let selected =
            block_on(actor.read_channels(xrk.clone(), vec![header.key.clone()])).unwrap();
        assert_eq!(selected.channels.len(), 1);
        assert_eq!(selected.series.len(), 1);
        assert_eq!(selected.channels[0].key, header.key);
        assert_eq!(selected.channels[0].sample_rate_hz, expected.sample_rate_hz);
        let actual = selected.channel(&header.key).unwrap();
        let expected = full.channel(&header.key).unwrap();
        assert_eq!(actual.times, expected.times, "{} timestamps", header.key);
        assert_eq!(actual.values, expected.values, "{} values", header.key);
    }
    let empty = block_on(actor.read_channels(xrk.clone(), vec![])).unwrap();
    assert!(empty.channels.is_empty());
    assert!(empty.series.is_empty());
    let key = metadata.channels[0].key.clone();
    let duplicate = block_on(actor.read_channels(xrk, vec![key.clone(), key])).unwrap();
    assert_eq!(duplicate.series.len(), 1);
}

#[test]
fn incremental_errors_do_not_poison_actor() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let actor = AimActor::spawn(&dll).unwrap();
    let missing = PathBuf::from("Z:/missing/not.xrk");
    assert!(matches!(
        block_on(actor.metadata(missing.clone())),
        Err(telemetry_core::TelemetryError::Dll(_))
    ));
    assert!(matches!(
        block_on(actor.read_channels(missing, vec![])),
        Err(telemetry_core::TelemetryError::Dll(_))
    ));
    assert!(matches!(
        block_on(actor.read_channels(xrk.clone(), vec!["not a channel".into()])),
        Err(telemetry_core::TelemetryError::NotFound(_))
    ));
    let dir = unique_temp_dir("incremental-damaged");
    fs::create_dir_all(&dir).unwrap();
    let damaged = dir.join("damaged.xrk");
    fs::write(&damaged, b"not an XRK file").unwrap();
    assert!(matches!(
        block_on(actor.metadata(damaged.clone())),
        Err(telemetry_core::TelemetryError::Dll(_))
    ));
    assert!(matches!(
        block_on(actor.read_channels(damaged, vec![])),
        Err(telemetry_core::TelemetryError::Dll(_))
    ));
    fs::remove_dir_all(dir).unwrap();
    assert!(!block_on(actor.metadata(xrk)).unwrap().channels.is_empty());
}
#[test]
fn bad_path_is_dll_error() {
    let _guard = lock();
    let (dll, _) = paths();
    let a = AimActor::spawn(&dll).unwrap();
    let e = block_on(a.open_xrk(PathBuf::from("Z:/missing/not.xrk"))).unwrap_err();
    assert!(matches!(e, telemetry_core::TelemetryError::Dll(_)));
}
#[test]
fn opens_du() {
    let _guard = lock();
    let (dll, _) = paths();
    let a = AimActor::spawn(&dll).unwrap();
    let d =
        block_on(a.open_xrk(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(r"..\..\Data\Du.xrk")))
            .unwrap();
    assert!(!d.channels.is_empty());
    assert!(d.meta.duration > 0.0);
    assert!(!d.laps.is_empty());
    assert!(d
        .channels
        .iter()
        .any(|c| c.name == "GPS Speed (AiM Interpolated)"));
}
#[test]
fn opens_lap_selection() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let a = AimActor::spawn(&dll).unwrap();
    let d = block_on(a.open_xrk_laps(xrk, vec![0])).unwrap();
    assert!(!d.channels.is_empty());
    assert!(!d.laps.is_empty());
    assert!(d.meta.duration > 0.0);
    let (_, series) = gps_speed(&d);
    assert!(!series.is_empty());
    assert!(series.times.windows(2).all(|w| w[0] <= w[1]));
}
#[test]
fn repeated_open_close() {
    let _guard = lock();
    let (dll, xrk) = paths();
    for _ in 0..50 {
        let a = AimActor::spawn(&dll).unwrap();
        let d = block_on(a.open_xrk(xrk.clone())).unwrap();
        assert!(d.meta.duration > 0.0);
    }
}

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..\\..\\tests\\golden")
}

fn unique_temp_dir(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "aim-ffi-step3-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[derive(Deserialize)]
struct CsvMetaFixture {
    speed_golden: SpeedGolden,
}
#[derive(Deserialize)]
struct SpeedGolden {
    channel: String,
    unit: String,
    sample_count: usize,
    sha256: String,
    source: String,
}

fn gps_speed(
    dataset: &telemetry_core::TelemetryDataset,
) -> (&telemetry_core::ChannelMeta, &telemetry_core::ChannelSeries) {
    let meta = dataset
        .channels
        .iter()
        .find(|meta| meta.name == "GPS Speed (AiM Interpolated)")
        .expect("AGX must expose GPS Speed");
    let series = dataset
        .series
        .get(&meta.key)
        .expect("GPS Speed metadata must have a series");
    (meta, series)
}

#[test]
fn damaged_file_returns_dll_error_instead_of_panicking() {
    let _guard = lock();
    let (dll, _) = paths();
    let dir = unique_temp_dir("damaged");
    fs::create_dir_all(&dir).unwrap();
    let damaged = dir.join("damaged.xrk");
    fs::write(&damaged, b"this is not an XRK file\0").unwrap();

    let actor = AimActor::spawn(&dll).unwrap();
    let result = block_on(actor.open_xrk(damaged));
    assert!(matches!(
        result,
        Err(telemetry_core::TelemetryError::Dll(_))
    ));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn opens_agx_from_chinese_and_space_path() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let dir = unique_temp_dir("\u{4e2d}\u{6587} \u{7a7a}\u{683c}");
    fs::create_dir_all(&dir).unwrap();
    let copied = dir.join("AGX \u{4e2d}\u{6587} sample.xrk");
    fs::copy(&xrk, &copied).unwrap();

    let actor = AimActor::spawn(&dll).unwrap();
    let dataset = block_on(actor.open_xrk(copied.clone())).unwrap();
    assert!(!dataset.channels.is_empty());
    assert_eq!(dataset.meta.file_path, copied);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn official_agx_speed_matches_golden_and_csv_metadata_fixture() {
    let _guard = lock();
    let (dll, xrk) = paths();
    let actor = AimActor::spawn(&dll).unwrap();
    let dataset = block_on(actor.open_xrk(xrk)).unwrap();
    let (meta, series) = gps_speed(&dataset);
    assert_eq!(meta.name, "GPS Speed (AiM Interpolated)");
    let speed_bin = fs::read(golden_dir().join("agx_speed.bin")).unwrap();
    assert!(!speed_bin.is_empty());
    assert_eq!(
        speed_bin.len() % 16,
        0,
        "golden must contain f64 time/value pairs"
    );
    let (chunks, remainder) = speed_bin.as_chunks::<16>();
    assert!(remainder.is_empty());
    let expected: Vec<(f64, f64)> = chunks
        .iter()
        .map(|chunk| {
            let mut time = [0_u8; 8];
            let mut value = [0_u8; 8];
            time.copy_from_slice(&chunk[..8]);
            value.copy_from_slice(&chunk[8..]);
            (f64::from_le_bytes(time), f64::from_le_bytes(value))
        })
        .collect();
    assert!(
        expected.len() >= 2,
        "CSV golden must contain at least two samples"
    );
    assert_eq!(series.times.len(), expected.len());
    assert_eq!(series.values.len(), expected.len());
    // The binary golden is captured from this same official DLL output.
    for (index, ((actual_time, actual_value), (expected_time, expected_value))) in series
        .times
        .iter()
        .zip(&series.values)
        .zip(&expected)
        .enumerate()
    {
        assert!(
            (*actual_time - *expected_time).abs() <= 1e-6,
            "GPS Speed timestamp mismatch at index {index}: actual={actual_time}, expected={expected_time}"
        );
        let tolerance = 1e-4_f64 * expected_value.abs().max(1.0);
        assert!(
            (f64::from(*actual_value) - expected_value).abs() <= tolerance,
            "GPS Speed mismatch at index {index}, t={actual_time}: actual={actual_value}, expected={expected_value}"
        );
    }

    assert_eq!(meta.unit, "km/h");
    let csv_meta: CsvMetaFixture =
        serde_json::from_str(&fs::read_to_string(golden_dir().join("agx_csv_meta.json")).unwrap())
            .unwrap();
    assert_eq!(csv_meta.speed_golden.channel, meta.name);
    assert_eq!(csv_meta.speed_golden.unit, meta.unit);
    assert_eq!(csv_meta.speed_golden.sample_count, expected.len());
    assert_eq!(
        csv_meta.speed_golden.source,
        "AiM DLL official GPS interpolated output from Data/AGX.xrk"
    );
    let digest = format!("{:x}", Sha256::digest(&speed_bin));
    assert_eq!(csv_meta.speed_golden.sha256, digest);
}
