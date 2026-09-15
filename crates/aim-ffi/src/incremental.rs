//! Header-only discovery and dependency-scoped reads. No DLL handle leaves the actor.
use super::*;
use std::collections::{HashMap, HashSet};

/// Header-only channel identity. Sample rates require timestamps and are not guessed.
#[derive(Clone, Debug)]
pub struct ImportChannel {
    pub key: String,
    pub name: String,
    pub unit: String,
    pub source: ChannelSource,
    pub dtype: ChannelDType,
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::cell::RefCell;

    // Observe real export calls, forwarding every call to the actual vendor DLL.
    // No generated samples, stubbed results, or timing-based assertions.
    thread_local! {
        static EXPORTS: RefCell<Option<[Samples; 3]>> = const { RefCell::new(None) };
        static READS: RefCell<Vec<(usize, i32)>> = const { RefCell::new(Vec::new()) };
    }
    unsafe fn forward(
        family: usize,
        file: i32,
        channel: i32,
        times: *mut f64,
        values: *mut f64,
        count: i32,
    ) -> i32 {
        READS.with(|reads| reads.borrow_mut().push((family, channel)));
        let export = EXPORTS.with(|exports| exports.borrow().unwrap()[family]);
        unsafe { export(file, channel, times, values, count) }
    }
    unsafe extern "C" fn standard(f: i32, c: i32, t: *mut f64, v: *mut f64, n: i32) -> i32 {
        unsafe { forward(0, f, c, t, v, n) }
    }
    unsafe extern "C" fn gps(f: i32, c: i32, t: *mut f64, v: *mut f64, n: i32) -> i32 {
        unsafe { forward(1, f, c, t, v, n) }
    }
    unsafe extern "C" fn raw(f: i32, c: i32, t: *mut f64, v: *mut f64, n: i32) -> i32 {
        unsafe { forward(2, f, c, t, v, n) }
    }

    #[test]
    fn real_agx_export_trace_proves_header_only_and_dependency_scoped_reads() {
        std::thread::spawn(|| {
            let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
            let path = root.join("Data/AGX.xrk");
            let mut dll =
                AimDll::load(&root.join("TestMatLabXRK/DLL-2022/MatLabXRK-2022-64-ReleaseU.dll"))
                    .unwrap();
            EXPORTS.with(|exports| {
                *exports.borrow_mut() =
                    Some([dll.standard.samples, dll.gps.samples, dll.raw.samples])
            });
            dll.standard.samples = standard;
            dll.gps.samples = gps;
            dll.raw.samples = raw;
            let metadata = dll
                .with_file(&path, |idx| dll.import_metadata(idx, &path))
                .unwrap();
            assert!(!metadata.channels.is_empty());
            READS
                .with(|reads| assert!(reads.borrow().is_empty(), "metadata must not read samples"));
            dll.with_file(&path, |idx| dll.selected_channels(idx, &path, &[]))
                .unwrap();
            let error = dll.with_file(&path, |idx| {
                dll.selected_channels(
                    idx,
                    &path,
                    &[metadata.channels[0].key.clone(), "missing".into()],
                )
            });
            assert!(matches!(error, Err(TelemetryError::NotFound(_))));
            READS.with(|reads| {
                assert!(
                    reads.borrow().is_empty(),
                    "empty/invalid selections must not read samples"
                )
            });

            for names in [
                vec!["GPS Speed (AiM Interpolated)"],
                vec!["GPS Latitude"],
                vec!["Distance on GPS Speed"],
                vec!["GPS Speed", "Distance on GPS Speed"],
            ] {
                READS.with(|reads| reads.borrow_mut().clear());
                let keys: Vec<_> = names
                    .iter()
                    .map(|name| {
                        metadata
                            .channels
                            .iter()
                            .find(|c| &c.name == name)
                            .unwrap()
                            .key
                            .clone()
                    })
                    .collect();
                dll.with_file(&path, |idx| dll.selected_channels(idx, &path, &keys))
                    .unwrap();
                let expected_names = match names[0] {
                    "GPS Speed (AiM Interpolated)" => vec!["GPS Speed (AiM Interpolated)"],
                    "GPS Latitude" => vec!["ECEF position_X", "ECEF position_Y", "ECEF position_Z"],
                    _ => vec!["ECEF velocity_X", "ECEF velocity_Y", "ECEF velocity_Z"],
                };
                let catalog = dll.with_file(&path, |idx| dll.catalog(idx)).unwrap();
                let mut expected: Vec<_> = expected_names
                    .iter()
                    .map(|name| {
                        let entry = catalog.iter().find(|e| &e.header.name == name).unwrap();
                        match entry.recipe {
                            Recipe::Native {
                                family, channel, ..
                            } => (family, channel),
                            _ => panic!("dependency must be native"),
                        }
                    })
                    .collect();
                expected.sort();
                READS.with(|reads| {
                    let mut actual = reads.borrow().clone();
                    actual.sort();
                    assert_eq!(
                        actual, expected,
                        "{names:?}: exactly the required exports, once each"
                    );
                });
            }
        })
        .join()
        .unwrap();
    }
}

/// Session fields available without reading channel samples.
#[derive(Clone, Debug)]
pub struct ImportSession {
    pub file_path: PathBuf,
    pub file_type: String,
    pub session: String,
    pub vehicle: String,
    pub racer: String,
    pub championship: String,
    pub date: String,
    pub start_time: String,
    pub duration: f64,
}

/// Discovery result has no series field or sample buffers by construction.
#[derive(Clone, Debug)]
pub struct ImportMetadata {
    pub meta: ImportSession,
    pub channels: Vec<ImportChannel>,
    pub laps: Vec<LapInfo>,
}

#[derive(Clone)]
enum Recipe {
    Native {
        family: usize,
        channel: i32,
        count: i32,
    },
    Position {
        inputs: [usize; 3],
        axis: usize,
    },
    Speed {
        inputs: [usize; 3],
    },
    Distance {
        speed: usize,
    },
}

struct Entry {
    header: ImportChannel,
    recipe: Recipe,
}

fn append(
    catalog: &mut Vec<Entry>,
    name: String,
    unit: String,
    source: ChannelSource,
    recipe: Recipe,
) {
    let base = if name.is_empty() { "unnamed" } else { &name };
    let mut key = base.to_string();
    let mut suffix = 2;
    while catalog.iter().any(|e| e.header.key == key) {
        key = format!("{base}#{suffix}");
        suffix += 1;
    }
    catalog.push(Entry {
        header: ImportChannel {
            key,
            name,
            unit,
            source,
            dtype: ChannelDType::Numeric,
        },
        recipe,
    });
}

impl AimDll {
    pub(super) fn with_file<T>(
        &self,
        path: &Path,
        read: impl FnOnce(i32) -> Result<T, TelemetryError>,
    ) -> Result<T, TelemetryError> {
        let encoded = mbcs(path)?;
        // SAFETY: encoded is a terminated ACP path, used only on the owning actor.
        let idx = unsafe { (self.open)(encoded.as_ptr().cast()) };
        if idx <= 0 {
            return Err(TelemetryError::Dll(format!(
                "open failed for {}: {}",
                path.display(),
                decode(unsafe { (self.last_error)() })
            )));
        }
        struct OpenFile<'a>(&'a AimDll, i32);
        impl Drop for OpenFile<'_> {
            fn drop(&mut self) {
                // SAFETY: successful open is closed exactly once, on the same actor.
                unsafe {
                    (self.0.close)(self.1);
                }
            }
        }
        let _file = OpenFile(self, idx);
        read(idx)
    }

    fn catalog(&self, idx: i32) -> Result<Vec<Entry>, TelemetryError> {
        let mut entries = Vec::new();
        for (family_index, family) in [&self.standard, &self.gps, &self.raw]
            .into_iter()
            .enumerate()
        {
            // SAFETY: idx is open on this actor; indices are bounded by vendor counts.
            let count = unsafe { (family.count)(idx) };
            if count < 0 {
                return Err(TelemetryError::Dll("channel count failed".into()));
            }
            for channel in 0..count {
                let n = unsafe { (family.sample_count)(idx, channel) };
                if n < 0 {
                    return Err(TelemetryError::Dll("sample count failed".into()));
                }
                if n == 0 {
                    continue;
                }
                let mut name = decode(unsafe { (family.name)(idx, channel) })
                    .trim()
                    .to_string();
                let mut unit = decode(unsafe { (family.units)(idx, channel) })
                    .trim()
                    .to_string();
                if family.source == ChannelSource::Gps {
                    if name.eq_ignore_ascii_case("GPS Speed") {
                        unit = "km/h".into();
                    }
                    name.push_str(" (AiM Interpolated)");
                }
                append(
                    &mut entries,
                    name,
                    unit,
                    family.source,
                    Recipe::Native {
                        family: family_index,
                        channel,
                        count: n,
                    },
                );
            }
        }
        let triple = |prefix: &str| -> Option<[usize; 3]> {
            let find = |axis| {
                entries.iter().position(|e| {
                    e.header.source == ChannelSource::GpsRaw
                        && e.header.name == format!("ECEF {prefix}_{axis}")
                })
            };
            Some([find("X")?, find("Y")?, find("Z")?])
        };
        let positions = triple("position");
        let velocities = triple("velocity");
        if let Some(inputs) = positions {
            for (axis, (name, unit)) in [
                ("GPS Latitude", "deg"),
                ("GPS Longitude", "deg"),
                ("GPS Altitude", "m"),
            ]
            .into_iter()
            .enumerate()
            {
                append(
                    &mut entries,
                    name.into(),
                    unit.into(),
                    ChannelSource::DerivedGps,
                    Recipe::Position { inputs, axis },
                );
            }
        }
        if let Some(inputs) = velocities {
            let speed = entries.len();
            append(
                &mut entries,
                "GPS Speed".into(),
                "km/h".into(),
                ChannelSource::DerivedGps,
                Recipe::Speed { inputs },
            );
            append(
                &mut entries,
                "Distance on GPS Speed".into(),
                "m".into(),
                ChannelSource::DerivedCalc,
                Recipe::Distance { speed },
            );
        }
        Ok(entries)
    }

    fn session_header(
        &self,
        idx: i32,
        path: &Path,
    ) -> Result<(ImportSession, Vec<LapInfo>), TelemetryError> {
        // SAFETY: all metadata exports use the currently open actor-owned file.
        let count = unsafe { (self.laps)(idx) };
        if count < 0 {
            return Err(TelemetryError::Dll("lap count failed".into()));
        }
        let mut laps = Vec::new();
        for index in 0..count {
            let (mut start, mut duration) = (0.0, 0.0);
            if unsafe { (self.lap_info)(idx, index, &mut start, &mut duration) } <= 0 {
                return Err(TelemetryError::Dll("lap info failed".into()));
            }
            laps.push(LapInfo {
                index: index as u32,
                start,
                duration,
            });
        }
        let mut duration = 0.0;
        if unsafe { (self.duration)(idx, &mut duration) } <= 0 || duration <= 0.0 {
            duration = laps
                .iter()
                .map(|l| l.start + l.duration)
                .fold(0.0, f64::max);
        }
        if !duration.is_finite() || duration <= 0.0 {
            return Err(TelemetryError::Dll("XRK reported invalid duration".into()));
        }
        let (date, start_time) = format_tm(unsafe { (self.date)(idx) });
        Ok((
            ImportSession {
                file_path: path.to_path_buf(),
                file_type: "xrk".into(),
                session: decode(unsafe { (self.session)(idx) }),
                vehicle: decode(unsafe { (self.vehicle)(idx) }),
                racer: decode(unsafe { (self.racer)(idx) }),
                championship: decode(unsafe { (self.championship)(idx) }),
                date,
                start_time,
                duration,
            },
            laps,
        ))
    }

    pub(super) fn import_metadata(
        &self,
        idx: i32,
        path: &Path,
    ) -> Result<ImportMetadata, TelemetryError> {
        let (meta, laps) = self.session_header(idx, path)?;
        let channels = self.catalog(idx)?.into_iter().map(|e| e.header).collect();
        Ok(ImportMetadata {
            meta,
            channels,
            laps,
        })
    }

    pub(super) fn selected_channels(
        &self,
        idx: i32,
        path: &Path,
        keys: &[String],
    ) -> Result<TelemetryDataset, TelemetryError> {
        let (header, laps) = self.session_header(idx, path)?;
        let catalog = self.catalog(idx)?;
        let mut selected = HashSet::new();
        for key in keys {
            selected.insert(
                catalog
                    .iter()
                    .position(|e| &e.header.key == key)
                    .ok_or_else(|| TelemetryError::NotFound(key.clone()))?,
            );
        }
        let mut loaded = HashMap::new();
        for index in 0..catalog.len() {
            if selected.contains(&index) {
                self.load_entry(idx, index, &catalog, &mut loaded)?;
            }
        }
        let mut series = HashMap::new();
        let mut channels = Vec::new();
        for (index, entry) in catalog.into_iter().enumerate() {
            if !selected.contains(&index) {
                continue;
            }
            let s = loaded.remove(&index).expect("selected entry loaded");
            let h = entry.header;
            channels.push(ChannelMeta {
                dtype: h.dtype,
                key: h.key.clone(),
                name: h.name,
                unit: h.unit,
                source: h.source,
                sample_rate_hz: sample_rate(&s),
            });
            series.insert(h.key, s);
        }
        let meta = SessionMeta {
            file_path: header.file_path,
            file_type: header.file_type,
            session: header.session,
            vehicle: header.vehicle,
            racer: header.racer,
            championship: header.championship,
            date: header.date,
            start_time: header.start_time,
            duration: header.duration,
            sample_rate_hz: channels
                .iter()
                .map(|c| c.sample_rate_hz)
                .filter(|r| *r > 0.0)
                .fold(0.0, f32::max),
            ..Default::default()
        };
        Ok(TelemetryDataset {
            meta,
            channels,
            series,
            laps,
        })
    }

    fn load_entry(
        &self,
        idx: i32,
        index: usize,
        catalog: &[Entry],
        loaded: &mut HashMap<usize, ChannelSeries>,
    ) -> Result<(), TelemetryError> {
        if loaded.contains_key(&index) {
            return Ok(());
        }
        let entry = &catalog[index];
        let result = match entry.recipe {
            Recipe::Native {
                family,
                channel,
                count,
            } => {
                let family = [&self.standard, &self.gps, &self.raw][family];
                let mut times = vec![0.0; count as usize];
                let mut values = vec![0.0; count as usize];
                // SAFETY: counts and channel index came from this open file. Both buffers
                // have the exact size required by the vendor API and remain alive for the call.
                let got = unsafe {
                    (family.samples)(idx, channel, times.as_mut_ptr(), values.as_mut_ptr(), count)
                };
                if got <= 0 || got > count {
                    return Err(TelemetryError::Dll(format!(
                        "sample read failed for {}: {got}",
                        entry.header.key
                    )));
                }
                times.truncate(got as usize);
                values.truncate(got as usize);
                let mut s = ChannelSeries {
                    times,
                    values: values.into_iter().map(|v| v as f32).collect(),
                };
                sort_series(&mut s);
                if family.source == ChannelSource::Gps {
                    for t in &mut s.times {
                        *t /= 1000.0;
                    }
                    if entry
                        .header
                        .name
                        .strip_suffix(" (AiM Interpolated)")
                        .is_some_and(|n| n.eq_ignore_ascii_case("GPS Speed"))
                    {
                        for v in &mut s.values {
                            *v *= 3.6;
                        }
                    }
                }
                s
            }
            Recipe::Position { inputs, .. } | Recipe::Speed { inputs } => {
                for input in inputs {
                    self.load_entry(idx, input, catalog, loaded)?;
                }
                let [x, y, z] = inputs.map(|i| &loaded[&i]);
                let values = if let Recipe::Position { axis, .. } = entry.recipe {
                    let (lat, lon, alt) = ecef_to_geodetic(&x.values, &y.values, &z.values);
                    match axis {
                        0 => lat.into_iter().map(|v| v as f32).collect(),
                        1 => lon.into_iter().map(|v| v as f32).collect(),
                        _ => alt,
                    }
                } else {
                    x.values
                        .iter()
                        .zip(&y.values)
                        .zip(&z.values)
                        .map(|((&a, &b), &c)| a.mul_add(a, b.mul_add(b, c * c)).sqrt() * 3.6)
                        .collect()
                };
                ChannelSeries {
                    times: x.times.clone(),
                    values,
                }
            }
            Recipe::Distance { speed } => {
                self.load_entry(idx, speed, catalog, loaded)?;
                let s = &loaded[&speed];
                let distance = integrate_distance(
                    &s.times,
                    &s.values.iter().map(|v| *v / 3.6).collect::<Vec<_>>(),
                );
                ChannelSeries {
                    times: s.times.clone(),
                    values: distance.into_iter().map(|v| v as f32).collect(),
                }
            }
        };
        loaded.insert(index, result);
        Ok(())
    }
}
