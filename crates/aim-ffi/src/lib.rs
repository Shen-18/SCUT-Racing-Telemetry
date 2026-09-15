//! Safe, actor-owned bridge to the vendor MatLabXRK DLL.
#![allow(unsafe_code)]

mod incremental;
pub use incremental::{ImportChannel, ImportMetadata, ImportSession};

use libloading::Library;
use std::{
    ffi::{c_char, c_double, CStr},
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{mpsc, Arc, Mutex},
    task::{Context, Poll, Waker},
    thread::{self, JoinHandle},
};
use telemetry_core::{
    ecef_to_geodetic, integrate_distance, ChannelDType, ChannelMeta, ChannelSeries, ChannelSource,
    LapInfo, SessionMeta, TelemetryDataset, TelemetryError,
};

type Open = unsafe extern "C" fn(*const c_char) -> i32;
type OpenLicence = unsafe extern "C" fn(*const c_char, *const c_char) -> i32;
type Close = unsafe extern "C" fn(i32) -> i32;
type CloseName = unsafe extern "C" fn(*const c_char) -> i32;
type LibraryText = unsafe extern "C" fn() -> *const c_char;
type Unsigned = unsafe extern "C" fn(i32) -> u32;
type DeviceCount = unsafe extern "C" fn(i32) -> i32;
type DeviceId = unsafe extern "C" fn(i32, i32) -> u32;
type LastError = unsafe extern "C" fn() -> *const c_char;
type Text = unsafe extern "C" fn(i32) -> *const c_char;
type Date = unsafe extern "C" fn(i32) -> *const Tm;
type Count = unsafe extern "C" fn(i32) -> i32;
type LapInfoFn = unsafe extern "C" fn(i32, i32, *mut c_double, *mut c_double) -> i32;
type Duration = unsafe extern "C" fn(i32, *mut c_double) -> i32;
type SetGpsFreq = unsafe extern "C" fn(c_double) -> i32;
type Name = unsafe extern "C" fn(i32, i32) -> *const c_char;
type SamplesCount = unsafe extern "C" fn(i32, i32) -> i32;
type Samples = unsafe extern "C" fn(i32, i32, *mut c_double, *mut c_double, i32) -> i32;
type LapSamplesCount = unsafe extern "C" fn(i32, i32, i32) -> i32;
type LapSamples = unsafe extern "C" fn(i32, i32, i32, *mut c_double, *mut c_double, i32) -> i32;

#[repr(C)]
struct Tm {
    sec: i32,
    min: i32,
    hour: i32,
    mday: i32,
    mon: i32,
    year: i32,
    wday: i32,
    yday: i32,
    isdst: i32,
}

struct Family {
    count: Count,
    name: Name,
    _name_no_spaces: Name,
    units: Name,
    sample_count: SamplesCount,
    samples: Samples,
    lap_count: LapSamplesCount,
    lap_samples: LapSamples,
    source: ChannelSource,
}

/// The vendor library and all symbols are confined to one actor thread.
#[allow(dead_code)]
struct AimDll {
    _library: Library,
    _not_send_sync: std::marker::PhantomData<*const ()>,
    _test_on_open_files: LibraryText,
    _library_date: LibraryText,
    _library_time: LibraryText,
    open: Open,
    _open_with_licence: OpenLicence,
    close: Close,
    _close_by_name: CloseName,
    last_error: LastError,
    _logger_id: Unsigned,
    _device_count: DeviceCount,
    _device_id: DeviceId,
    vehicle: Text,
    track: Text,
    racer: Text,
    championship: Text,
    session: Text,
    date: Date,
    laps: Count,
    lap_info: LapInfoFn,
    duration: Duration,
    _set_gps_sample_freq: SetGpsFreq,
    standard: Family,
    gps: Family,
    raw: Family,
}

impl AimDll {
    fn load(path: &Path) -> Result<Self, TelemetryError> {
        if !path.is_file() {
            return Err(TelemetryError::Dll(format!(
                "DLL not found: {}",
                path.display()
            )));
        }
        let dep = path.parent().and_then(Path::parent).map(|p| p.join("64"));
        if let Some(dep) = dep {
            set_dll_directory(&dep)?;
        }
        // SAFETY: the path is user-selected and the library is kept alive in AimDll.
        let library =
            unsafe { Library::new(path) }.map_err(|e| TelemetryError::Dll(e.to_string()))?;
        macro_rules! typed {
            ($n:literal, $t:ty) => {{
                // SAFETY: symbol names and signatures are defined by MatLabXRK.h.
                let symbol = unsafe { library.get::<$t>(concat!($n, "\0").as_bytes()) }
                    .map_err(|e| TelemetryError::Dll(format!("missing export {}: {}", $n, e)))?;
                *symbol
            }};
        }
        Ok(Self {
            _library_date: typed!("get_library_date", LibraryText),
            _library_time: typed!("get_library_time", LibraryText),
            open: typed!("open_file", Open),
            _open_with_licence: typed!("open_file_with_licence", OpenLicence),
            close: typed!("close_file_i", Close),
            _close_by_name: typed!("close_file_n", CloseName),
            last_error: typed!("get_last_open_error", LastError),
            _logger_id: typed!("get_logger_id", Unsigned),
            _device_count: typed!("get_number_of_devices", DeviceCount),
            _device_id: typed!("get_device_id", DeviceId),
            vehicle: typed!("get_vehicle_name", Text),
            track: typed!("get_track_name", Text),
            racer: typed!("get_racer_name", Text),
            championship: typed!("get_championship_name", Text),
            session: typed!("get_session_type_name", Text),
            date: typed!("get_date_and_time", Date),
            laps: typed!("get_laps_count", Count),
            lap_info: typed!("get_lap_info", LapInfoFn),
            duration: typed!("get_session_duration", Duration),
            _set_gps_sample_freq: typed!("set_GPS_sample_freq", SetGpsFreq),
            standard: Family {
                count: typed!("get_channels_count", Count),
                name: typed!("get_channel_name", Name),
                _name_no_spaces: typed!("get_channel_name_no_spaces", Name),
                units: typed!("get_channel_units", Name),
                sample_count: typed!("get_channel_samples_count", SamplesCount),
                samples: typed!("get_channel_samples", Samples),
                lap_count: typed!("get_lap_channel_samples_count", LapSamplesCount),
                lap_samples: typed!("get_lap_channel_samples", LapSamples),
                source: ChannelSource::Standard,
            },
            gps: Family {
                count: typed!("get_GPS_channels_count", Count),
                name: typed!("get_GPS_channel_name", Name),
                _name_no_spaces: typed!("get_GPS_channel_name_no_spaces", Name),
                units: typed!("get_GPS_channel_units", Name),
                sample_count: typed!("get_GPS_channel_samples_count", SamplesCount),
                samples: typed!("get_GPS_channel_samples", Samples),
                lap_count: typed!("get_lap_GPS_channel_samples_count", LapSamplesCount),
                lap_samples: typed!("get_lap_GPS_channel_samples", LapSamples),
                source: ChannelSource::Gps,
            },
            raw: Family {
                count: typed!("get_GPS_raw_channels_count", Count),
                name: typed!("get_GPS_raw_channel_name", Name),
                _name_no_spaces: typed!("get_GPS_raw_channel_name_no_spaces", Name),
                units: typed!("get_GPS_raw_channel_units", Name),
                sample_count: typed!("get_GPS_raw_channel_samples_count", SamplesCount),
                samples: typed!("get_GPS_raw_channel_samples", Samples),
                lap_count: typed!("get_lap_GPS_raw_channel_samples_count", LapSamplesCount),
                lap_samples: typed!("get_lap_GPS_raw_channel_samples", LapSamples),
                source: ChannelSource::GpsRaw,
            },
            _test_on_open_files: typed!("library_test_on_open_files", LibraryText),
            _library: library,
            _not_send_sync: std::marker::PhantomData,
        })
    }
}

fn decode(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: vendor returns a null-terminated string valid for the open file lifetime.
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

fn mbcs(path: &Path) -> Result<Vec<u8>, TelemetryError> {
    let absolute = path
        .canonicalize()
        .map_err(|e| TelemetryError::Dll(format!("{}: {}", path.display(), e)))?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = absolute.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut out = vec![0u8; wide.len() * 2];
        // SAFETY: buffers are valid and lengths are bounded by isize::MAX.
        let n = unsafe {
            WideCharToMultiByte(
                0,
                0,
                wide.as_ptr(),
                -1,
                out.as_mut_ptr() as *mut i8,
                out.len() as i32,
                std::ptr::null(),
                std::ptr::null_mut(),
            )
        };
        if n <= 0 {
            return Err(TelemetryError::Dll(
                "path cannot be encoded using Windows ACP".into(),
            ));
        }
        out.truncate(n as usize);
        Ok(out)
    }
    #[cfg(not(windows))]
    {
        Ok(absolute
            .as_os_str()
            .to_string_lossy()
            .into_owned()
            .into_bytes()
            .into_iter()
            .chain(Some(0))
            .collect())
    }
}

#[cfg(windows)]
fn set_dll_directory(path: &Path) -> Result<(), TelemetryError> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: wide is a valid null-terminated UTF-16 path.
    let ok = unsafe { SetDllDirectoryW(wide.as_ptr()) };
    if ok == 0 {
        Err(TelemetryError::Dll(format!(
            "SetDllDirectoryW failed: {}",
            path.display()
        )))
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn set_dll_directory(_: &Path) -> Result<(), TelemetryError> {
    Ok(())
}
#[cfg(windows)]
extern "system" {
    fn SetDllDirectoryW(path: *const u16) -> i32;
    fn WideCharToMultiByte(
        cp: u32,
        flags: u32,
        wide: *const u16,
        len: i32,
        out: *mut i8,
        out_len: i32,
        default: *const i8,
        used: *mut i32,
    ) -> i32;
}

impl AimDll {
    fn read_family(
        &self,
        idx: i32,
        family: &Family,
        lap: Option<i32>,
    ) -> Result<Vec<(String, String, ChannelSeries, ChannelSource)>, TelemetryError> {
        let count = unsafe { (family.count)(idx) };
        if count < 0 {
            return Err(TelemetryError::Dll("channel count failed".into()));
        }
        let mut result = Vec::new();
        for c in 0..count {
            let name = decode(unsafe { (family.name)(idx, c) });
            let unit = decode(unsafe { (family.units)(idx, c) });
            let n = match lap {
                Some(l) => unsafe { (family.lap_count)(idx, l, c) },
                None => unsafe { (family.sample_count)(idx, c) },
            };
            if n <= 0 {
                continue;
            }
            let mut times = vec![0.0; n as usize];
            let mut values = vec![0.0; n as usize];
            let got = match lap {
                Some(l) => unsafe {
                    (family.lap_samples)(idx, l, c, times.as_mut_ptr(), values.as_mut_ptr(), n)
                },
                None => unsafe {
                    (family.samples)(idx, c, times.as_mut_ptr(), values.as_mut_ptr(), n)
                },
            };
            if got <= 0 {
                continue;
            }
            times.truncate(got as usize);
            values.truncate(got as usize);
            let mut pairs: Vec<_> = times
                .into_iter()
                .zip(values.into_iter().map(|v| v as f32))
                .collect();
            pairs.sort_by(|a, b| a.0.total_cmp(&b.0));
            let (mut times, mut values): (Vec<_>, Vec<_>) = pairs.into_iter().unzip();
            let mut unit = unit;
            if family.source == ChannelSource::Gps {
                for t in &mut times {
                    *t /= 1000.0;
                }
                if name.trim().eq_ignore_ascii_case("GPS Speed") {
                    for v in &mut values {
                        *v *= 3.6;
                    }
                    unit = "km/h".into();
                }
            }
            result.push((
                name.trim().to_string(),
                unit.trim().to_string(),
                ChannelSeries { times, values },
                family.source,
            ));
        }
        Ok(result)
    }

    fn open_dataset(
        &self,
        path: PathBuf,
        requested_laps: Option<Vec<u32>>,
    ) -> Result<TelemetryDataset, TelemetryError> {
        let encoded = mbcs(&path)?;
        // SAFETY: encoded is a stable, null-terminated MBCS path for this call.
        let idx = unsafe { (self.open)(encoded.as_ptr() as *const c_char) };
        if idx <= 0 {
            return Err(TelemetryError::Dll(format!(
                "open failed for {}: {}",
                path.display(),
                decode(unsafe { (self.last_error)() })
            )));
        }
        let result = self.build_dataset(idx, path, requested_laps);
        // SAFETY: idx came from open_file and is closed exactly once on this actor thread.
        let _ = unsafe { (self.close)(idx) };
        result
    }

    fn build_dataset(
        &self,
        idx: i32,
        path: PathBuf,
        requested_laps: Option<Vec<u32>>,
    ) -> Result<TelemetryDataset, TelemetryError> {
        let mut channels = Vec::new();
        let mut series = std::collections::HashMap::new();
        let families = [&self.standard, &self.gps, &self.raw];
        if let Some(lap_ids) = requested_laps.as_ref() {
            let mut merged: std::collections::BTreeMap<
                (String, String, u8),
                (ChannelSource, ChannelSeries),
            > = std::collections::BTreeMap::new();
            for &lap_id in lap_ids {
                for family in families {
                    for (mut n, u, mut s, src) in
                        self.read_family(idx, family, Some(lap_id as i32))?
                    {
                        if src == ChannelSource::Gps {
                            n.push_str(" (AiM Interpolated)");
                        }
                        let key = (n.clone(), u.clone(), src as u8);
                        if let Some((_, existing)) = merged.get_mut(&key) {
                            existing.times.append(&mut s.times);
                            existing.values.append(&mut s.values);
                            sort_series(existing);
                        } else {
                            merged.insert(key, (src, s));
                        }
                    }
                }
            }
            for ((n, u, _), (src, s)) in merged {
                add_channel(&mut channels, &mut series, n, u, s, src);
            }
        } else {
            for family in families {
                for (mut n, u, s, src) in self.read_family(idx, family, None)? {
                    if src == ChannelSource::Gps {
                        n.push_str(" (AiM Interpolated)");
                    }
                    add_channel(&mut channels, &mut series, n, u, s, src);
                }
            }
        }
        let raw = |name: &str| -> Option<ChannelSeries> {
            channels
                .iter()
                .find(|m| m.source == ChannelSource::GpsRaw && m.name == name)
                .and_then(|m| series.get(&m.key))
                .cloned()
        };
        let pos_x = raw("ECEF position_X");
        let pos_y = raw("ECEF position_Y");
        let pos_z = raw("ECEF position_Z");
        let vel_x = raw("ECEF velocity_X");
        let vel_y = raw("ECEF velocity_Y");
        let vel_z = raw("ECEF velocity_Z");

        if let (Some(x), Some(y), Some(z)) = (pos_x, pos_y, pos_z) {
            let (lat, lon, alt) = ecef_to_geodetic(&x.values, &y.values, &z.values);
            add_channel(
                &mut channels,
                &mut series,
                "GPS Latitude".into(),
                "deg".into(),
                ChannelSeries {
                    times: x.times.clone(),
                    values: lat.into_iter().map(|v| v as f32).collect(),
                },
                ChannelSource::DerivedGps,
            );
            add_channel(
                &mut channels,
                &mut series,
                "GPS Longitude".into(),
                "deg".into(),
                ChannelSeries {
                    times: x.times.clone(),
                    values: lon.into_iter().map(|v| v as f32).collect(),
                },
                ChannelSource::DerivedGps,
            );
            add_channel(
                &mut channels,
                &mut series,
                "GPS Altitude".into(),
                "m".into(),
                ChannelSeries {
                    times: x.times,
                    values: alt,
                },
                ChannelSource::DerivedGps,
            );
        }
        if let (Some(x), Some(y), Some(z)) = (vel_x, vel_y, vel_z) {
            let values = x
                .values
                .iter()
                .zip(&y.values)
                .zip(&z.values)
                .map(|((&a, &b), &c)| a.mul_add(a, b.mul_add(b, c * c)).sqrt() * 3.6)
                .collect();
            add_channel(
                &mut channels,
                &mut series,
                "GPS Speed".into(),
                "km/h".into(),
                ChannelSeries {
                    times: x.times,
                    values,
                },
                ChannelSource::DerivedGps,
            );
        }
        if let Some(raw_speed) = channels
            .iter()
            .find(|m| m.name == "GPS Speed" && m.source == ChannelSource::DerivedGps)
            .and_then(|m| series.get(&m.key))
            .cloned()
        {
            let d = integrate_distance(
                &raw_speed.times,
                &raw_speed
                    .values
                    .iter()
                    .map(|v| *v / 3.6)
                    .collect::<Vec<_>>(),
            );
            add_channel(
                &mut channels,
                &mut series,
                "Distance on GPS Speed".into(),
                "m".into(),
                ChannelSeries {
                    times: raw_speed.times,
                    values: d.into_iter().map(|v| v as f32).collect(),
                },
                ChannelSource::DerivedCalc,
            );
        }
        let mut laps = Vec::new();
        let lap_count = unsafe { (self.laps)(idx) }.max(0);
        for l in 0..lap_count {
            let mut start = 0.0;
            let mut duration = 0.0;
            if unsafe { (self.lap_info)(idx, l, &mut start, &mut duration) } > 0 {
                laps.push(LapInfo {
                    index: l as u32,
                    start,
                    duration,
                });
            }
        }
        let mut duration = 0.0;
        if unsafe { (self.duration)(idx, &mut duration) } <= 0 || duration <= 0.0 {
            duration = laps
                .iter()
                .map(|l| l.start + l.duration)
                .fold(0.0, f64::max);
        }
        if duration <= 0.0 {
            return Err(TelemetryError::Dll("XRK reported zero duration".into()));
        }
        let avg_rate = channels
            .iter()
            .map(|c| c.sample_rate_hz)
            .filter(|r| *r > 0.0)
            .fold(0.0_f32, f32::max);
        let tm = unsafe { (self.date)(idx) };
        let (date, start_time) = format_tm(tm);
        let meta = SessionMeta {
            file_path: path,
            file_type: "xrk".into(),
            session: decode(unsafe { (self.session)(idx) }),
            vehicle: decode(unsafe { (self.vehicle)(idx) }),
            racer: decode(unsafe { (self.racer)(idx) }),
            championship: decode(unsafe { (self.championship)(idx) }),
            date,
            start_time,
            duration,
            sample_rate_hz: avg_rate,
            ..Default::default()
        };
        Ok(TelemetryDataset {
            meta,
            channels,
            series,
            laps,
        })
    }
}

fn format_tm(tm: *const Tm) -> (String, String) {
    if tm.is_null() {
        return (String::new(), String::new());
    }
    // SAFETY: the vendor returns a pointer to a valid struct for the open file lifetime.
    let tm = unsafe { &*tm };
    if !(1..=12).contains(&(tm.mon + 1))
        || !(1..=31).contains(&tm.mday)
        || !(0..=23).contains(&tm.hour)
        || !(0..=59).contains(&tm.min)
        || !(0..=60).contains(&tm.sec)
    {
        return (String::new(), String::new());
    }
    (
        format!("{:04}-{:02}-{:02}", tm.year + 1900, tm.mon + 1, tm.mday),
        format!("{:02}:{:02}:{:02}", tm.hour, tm.min, tm.sec),
    )
}

fn sort_series(series: &mut ChannelSeries) {
    let mut pairs: Vec<_> = series
        .times
        .iter()
        .copied()
        .zip(series.values.iter().copied())
        .collect();
    pairs.sort_by(|a, b| a.0.total_cmp(&b.0));
    (series.times, series.values) = pairs.into_iter().unzip();
}

fn add_channel(
    channels: &mut Vec<ChannelMeta>,
    series: &mut std::collections::HashMap<String, ChannelSeries>,
    name: String,
    unit: String,
    s: ChannelSeries,
    source: ChannelSource,
) {
    let base = if name.is_empty() {
        "unnamed".to_string()
    } else {
        name.clone()
    };
    let mut key = base.clone();
    let mut i = 2;
    while series.contains_key(&key) {
        key = format!("{}#{}", base, i);
        i += 1;
    }
    channels.push(ChannelMeta {
        dtype: ChannelDType::Numeric,
        key: key.clone(),
        name,
        unit,
        source,
        sample_rate_hz: sample_rate(&s),
    });
    series.insert(key, s);
}
fn sample_rate(s: &ChannelSeries) -> f32 {
    if s.times.len() < 2 {
        return 0.0;
    }
    let dt = (s.times[s.times.len() - 1] - s.times[0]) / (s.times.len() - 1) as f64;
    if dt > 0.0 {
        (1.0 / dt) as f32
    } else {
        0.0
    }
}

type Request = Box<dyn FnOnce(&AimDll) + Send>;
struct ReplyState<T> {
    result: Option<Result<T, TelemetryError>>,
    waker: Option<Waker>,
}
struct DatasetFuture<T> {
    state: Arc<Mutex<ReplyState<T>>>,
}
impl<T> Future for DatasetFuture<T> {
    type Output = Result<T, TelemetryError>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut s = self.state.lock().expect("reply mutex poisoned");
        if let Some(r) = s.result.take() {
            Poll::Ready(r)
        } else {
            s.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

/// Single-threaded asynchronous actor around the non-thread-safe vendor API.
pub struct AimActor {
    tx: mpsc::Sender<Option<Request>>,
    join: Option<JoinHandle<()>>,
}
impl AimActor {
    pub fn spawn(dll_path: &Path) -> Result<Self, TelemetryError> {
        let dll_path = dll_path.to_path_buf();
        let (tx, rx) = mpsc::channel::<Option<Request>>();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let join = thread::spawn(move || match AimDll::load(&dll_path) {
            Ok(dll) => {
                let _ = ready_tx.send(Ok(()));
                while let Ok(Some(req)) = rx.recv() {
                    req(&dll);
                }
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        });
        ready_rx
            .recv()
            .map_err(|e| TelemetryError::Dll(e.to_string()))??;
        Ok(Self {
            tx,
            join: Some(join),
        })
    }
    pub fn open_xrk(
        &self,
        path: PathBuf,
    ) -> impl Future<Output = Result<TelemetryDataset, TelemetryError>> + Send {
        self.submit(move |dll| dll.open_dataset(path, None))
    }
    pub fn open_xrk_laps(
        &self,
        path: PathBuf,
        laps: Vec<u32>,
    ) -> impl Future<Output = Result<TelemetryDataset, TelemetryError>> + Send {
        self.submit(move |dll| dll.open_dataset(path, Some(laps)))
    }
    /// Read the session and channel catalog without calling sample-buffer exports.
    /// Rates are deliberately absent: the DLL exposes no header-only rate query.
    pub fn metadata(
        &self,
        path: PathBuf,
    ) -> impl Future<Output = Result<ImportMetadata, TelemetryError>> + Send {
        self.submit(move |dll| dll.with_file(&path, |idx| dll.import_metadata(idx, &path)))
    }

    /// Reopen on this actor and read only selected catalog keys and their GPS dependencies.
    /// Returns only requested channels, in catalog order; duplicates are collapsed.
    /// Empty selection reads no samples. Unknown keys return `NotFound` before sample reads.
    /// The source file must remain unchanged between metadata and subsequent reads.
    pub fn read_channels(
        &self,
        path: PathBuf,
        channels: Vec<String>,
    ) -> impl Future<Output = Result<TelemetryDataset, TelemetryError>> + Send {
        self.submit(move |dll| {
            dll.with_file(&path, |idx| dll.selected_channels(idx, &path, &channels))
        })
    }

    fn submit<T: Send + 'static>(
        &self,
        work: impl FnOnce(&AimDll) -> Result<T, TelemetryError> + Send + 'static,
    ) -> DatasetFuture<T> {
        let state = Arc::new(Mutex::new(ReplyState {
            result: None,
            waker: None,
        }));
        let reply = state.clone();
        let request: Request = Box::new(move |dll| {
            let result = work(dll);
            let waker = {
                let mut s = reply.lock().expect("reply mutex poisoned");
                s.result = Some(result);
                s.waker.take()
            };
            if let Some(waker) = waker {
                waker.wake();
            }
        });
        if self.tx.send(Some(request)).is_err() {
            state.lock().expect("reply mutex poisoned").result =
                Some(Err(TelemetryError::Dll("Aim actor stopped".into())));
        };
        DatasetFuture { state }
    }
}
impl Drop for AimActor {
    fn drop(&mut self) {
        let _ = self.tx.send(None);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {}
