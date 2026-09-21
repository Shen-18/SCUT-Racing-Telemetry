use cache_core::{CacheManifest, CacheState};
use std::path::Path;
use telemetry_ipc::RecordSummary;

pub fn scan_records(cache_root: &Path, query: &str) -> Vec<RecordSummary> {
    let needle = query.trim().to_lowercase();
    let datasets = cache_root.join("datasets");
    let mut records = Vec::new();
    let Ok(entries) = std::fs::read_dir(datasets) else {
        return records;
    };
    for entry in entries.flatten() {
        let path = entry.path().join("manifest.json");
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_slice::<CacheManifest>(&bytes) else {
            continue;
        };
        let meta = &manifest.meta;
        let file_name = Path::new(&meta.file_path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| meta.file_path.to_string_lossy().into_owned());
        let summary = RecordSummary {
            file_hash: manifest.identity.hash.clone(),
            file_name,
            file_type: meta.file_type.clone(),
            session: meta.session.clone(),
            vehicle: meta.vehicle.clone(),
            racer: meta.racer.clone(),
            record_date: meta.date.clone(),
            start_time: meta.start_time.clone(),
            duration: meta.duration,
            channel_count: manifest.channels.len() as u64,
            file_size: manifest.identity.size,
            source_mtime_unix: manifest.identity.mtime,
            cache_state: format_state(manifest.state),
        };
        if needle.is_empty()
            || [
                summary.file_name.as_str(),
                summary.session.as_str(),
                summary.vehicle.as_str(),
                summary.racer.as_str(),
            ]
            .join(" ")
            .to_lowercase()
            .contains(&needle)
        {
            records.push(summary);
        }
    }
    records.sort_by_key(|r| std::cmp::Reverse(r.source_mtime_unix));
    records
}

fn format_state(state: CacheState) -> String {
    format!("{state:?}")
}
