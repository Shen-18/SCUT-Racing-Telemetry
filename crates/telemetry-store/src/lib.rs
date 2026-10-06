//! SQLite index for records and their cache metadata.
#![deny(unsafe_code)]

use cache_core::{CacheManifest, CacheRoot};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json;
use std::{path::{Path, PathBuf}, sync::Mutex};
use telemetry_ipc::RecordSummary;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct TelemetryStore {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl TelemetryStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        let store = Self { path: path.to_path_buf(), connection: Mutex::new(connection) };
        store.migrate()?;
        Ok(store)
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn migrate(&self) -> Result<()> {
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', '2');
            UPDATE schema_meta SET value = '2' WHERE key = 'schema_version';

            CREATE TABLE IF NOT EXISTS datasets (
                record_id TEXT PRIMARY KEY NOT NULL,
                file_hash TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                file_type TEXT NOT NULL,
                source_path TEXT NOT NULL,
                dataset_path TEXT NOT NULL,
                session TEXT NOT NULL,
                vehicle TEXT NOT NULL,
                racer TEXT NOT NULL,
                championship TEXT NOT NULL,
                comment TEXT NOT NULL,
                record_date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                sample_rate_hz REAL NOT NULL,
                duration REAL NOT NULL,
                channel_count INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                source_mtime_unix INTEGER NOT NULL,
                cache_state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dataset_channels (
                dataset_id TEXT NOT NULL REFERENCES datasets(record_id) ON DELETE CASCADE,
                channel_key TEXT NOT NULL,
                channel_name TEXT NOT NULL,
                unit TEXT NOT NULL,
                source TEXT NOT NULL,
                dtype TEXT NOT NULL,
                sample_rate_hz REAL NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY(dataset_id, channel_key)
            );
            CREATE INDEX IF NOT EXISTS idx_dataset_channels_dataset ON dataset_channels(dataset_id, position);

            CREATE TABLE IF NOT EXISTS dataset_preferences (
                dataset_id TEXT PRIMARY KEY NOT NULL REFERENCES datasets(record_id) ON DELETE CASCADE,
                selected_channels_json TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS local_record_notes (
                record_id TEXT PRIMARY KEY NOT NULL REFERENCES datasets(record_id) ON DELETE CASCADE,
                note TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS record_notes (
                record_id TEXT PRIMARY KEY NOT NULL REFERENCES datasets(record_id) ON DELETE CASCADE,
                note TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO record_notes(record_id, note, updated_at)
                SELECT record_id, note, updated_at FROM local_record_notes;

            CREATE TABLE IF NOT EXISTS date_notes (
                date_key TEXT PRIMARY KEY NOT NULL,
                note TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_datasets_record_date ON datasets(record_date);
            CREATE INDEX IF NOT EXISTS idx_datasets_source_mtime ON datasets(source_mtime_unix DESC);
            CREATE INDEX IF NOT EXISTS idx_datasets_file_name ON datasets(file_name COLLATE NOCASE);
            ",
        )?;
        Ok(())
    }

    pub fn upsert_manifest(&self, manifest: &CacheManifest, dataset_path: &str) -> Result<String> {
        let file_hash = &manifest.identity.hash;
        let file_name = Path::new(&manifest.meta.file_path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| manifest.meta.file_path.to_string_lossy().into_owned());
        let now = unix_now();
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        let transaction = connection.unchecked_transaction()?;
        let existing_id: Option<String> = transaction
            .query_row(
                "SELECT record_id FROM datasets WHERE file_hash = ?1",
                [file_hash],
                |row| row.get(0),
            )
            .optional()?;
        let record_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        transaction.execute(
            "INSERT INTO datasets (
                record_id, file_hash, file_name, file_type, source_path, dataset_path,
                session, vehicle, racer, championship, comment, record_date, start_time,
                sample_rate_hz, duration, channel_count, file_size, source_mtime_unix,
                cache_state, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                      ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)
            ON CONFLICT(file_hash) DO UPDATE SET
                file_name = excluded.file_name,
                file_type = excluded.file_type,
                source_path = excluded.source_path,
                dataset_path = excluded.dataset_path,
                session = excluded.session,
                vehicle = excluded.vehicle,
                racer = excluded.racer,
                championship = excluded.championship,
                comment = excluded.comment,
                record_date = excluded.record_date,
                start_time = excluded.start_time,
                sample_rate_hz = excluded.sample_rate_hz,
                duration = excluded.duration,
                channel_count = excluded.channel_count,
                file_size = excluded.file_size,
                source_mtime_unix = excluded.source_mtime_unix,
                cache_state = excluded.cache_state,
                updated_at = excluded.updated_at",
            params![
                record_id,
                file_hash,
                file_name,
                manifest.meta.file_type,
                manifest.meta.file_path.to_string_lossy().as_ref(),
                dataset_path,
                manifest.meta.session,
                manifest.meta.vehicle,
                manifest.meta.racer,
                manifest.meta.championship,
                manifest.meta.comment,
                manifest.meta.date,
                manifest.meta.start_time,
                f64::from(manifest.meta.sample_rate_hz),
                manifest.meta.duration,
                manifest.channels.len() as i64,
                manifest.identity.size as i64,
                manifest.identity.mtime as i64,
                format!("{:?}", manifest.state),
                now,
            ],
        )?;
        transaction.execute("DELETE FROM dataset_channels WHERE dataset_id = ?1", [&record_id])?;
        for (position, channel) in manifest.channels.iter().enumerate() {
            transaction.execute(
                "INSERT INTO dataset_channels (
                    dataset_id, channel_key, channel_name, unit, source, dtype, sample_rate_hz, position
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    record_id,
                    channel.meta.key,
                    channel.meta.name,
                    channel.meta.unit,
                    format!("{:?}", channel.meta.source),
                    format!("{:?}", channel.meta.dtype),
                    f64::from(channel.meta.sample_rate_hz),
                    position as i64,
                ],
            )?;
        }
        transaction.commit()?;
        Ok(record_id)
    }

    pub fn reconcile_cache(&self, cache_root: &Path) -> Result<usize> {
        let cache = CacheRoot::open(cache_root).map_err(|error| StoreError::Io(std::io::Error::other(error)))?;
        let datasets = cache_root.join("datasets");
        let mut imported = 0;
        for entry in std::fs::read_dir(datasets)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let Ok(bytes) = std::fs::read(entry.path().join("manifest.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_slice::<CacheManifest>(&bytes) else {
                continue;
            };
            let hash = manifest.identity.hash;
            let Ok(dataset) = cache.dataset(&hash) else {
                continue;
            };
            let path = cache
                .dataset_relative_path(&hash)
                .map_err(|error| StoreError::Io(std::io::Error::other(error)))?;
            self.upsert_manifest(dataset.manifest(), &path)?;
            imported += 1;
        }
        Ok(imported)
    }

    pub fn delete_by_hash(&self, file_hash: &str) -> Result<bool> {
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        Ok(connection.execute("DELETE FROM datasets WHERE file_hash = ?1", [file_hash])? > 0)
    }

    pub fn list_records(&self, query: &str) -> Result<Vec<RecordSummary>> {
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        let needle = query.trim().to_lowercase();
        let pattern = format!("%{needle}%");
        let mut statement = connection.prepare(
            "SELECT d.file_hash, d.file_name, d.file_type, d.session, d.vehicle, d.racer,
                    d.record_date, d.start_time, d.duration, d.channel_count, d.file_size,
                    d.source_mtime_unix, d.cache_state,
                    COALESCE(rn.note, ''), COALESCE(dn.note, '')
             FROM datasets d
             LEFT JOIN record_notes rn ON rn.record_id = d.record_id
             LEFT JOIN date_notes dn ON dn.date_key = d.record_date
             WHERE ?1 = '%%'
                OR LOWER(d.file_name) LIKE ?1
                OR LOWER(d.session) LIKE ?1
                OR LOWER(d.vehicle) LIKE ?1
                OR LOWER(d.racer) LIKE ?1
             ORDER BY d.source_mtime_unix DESC, d.file_hash ASC",
        )?;
        let rows = statement.query_map([pattern], |row| {
            Ok(RecordSummary {
                file_hash: row.get(0)?,
                file_name: row.get(1)?,
                file_type: row.get(2)?,
                session: row.get(3)?,
                vehicle: row.get(4)?,
                racer: row.get(5)?,
                record_date: row.get(6)?,
                start_time: row.get(7)?,
                duration: row.get(8)?,
                channel_count: row.get::<_, i64>(9)?.max(0) as u64,
                file_size: row.get::<_, i64>(10)?.max(0) as u64,
                source_mtime_unix: row.get::<_, i64>(11)?.max(0) as u64,
                cache_state: row.get(12)?,
                record_note: row.get(13)?,
                date_note: row.get(14)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(StoreError::from)
    }

    fn dataset_id(&self, file_hash: &str) -> Result<Option<String>> {
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        connection
            .query_row(
                "SELECT record_id FROM datasets WHERE file_hash = ?1",
                [file_hash],
                |row| row.get(0),
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn set_record_note(&self, file_hash: &str, note: &str) -> Result<bool> {
        let Some(dataset_id) = self.dataset_id(file_hash)? else {
            return Ok(false);
        };
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        if note.trim().is_empty() {
            connection.execute("DELETE FROM record_notes WHERE record_id = ?1", [&dataset_id])?;
        } else {
            connection.execute(
                "INSERT INTO record_notes(record_id, note, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(record_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
                params![dataset_id, note, unix_now()],
            )?;
        }
        Ok(true)
    }

    pub fn set_date_note(&self, date_key: &str, note: &str) -> Result<()> {
        let date_key = date_key.trim();
        if date_key.is_empty() {
            return Ok(());
        }
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        if note.trim().is_empty() {
            connection.execute("DELETE FROM date_notes WHERE date_key = ?1", [date_key])?;
        } else {
            connection.execute(
                "INSERT INTO date_notes(date_key, note, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(date_key) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
                params![date_key, note, unix_now()],
            )?;
        }
        Ok(())
    }

    pub fn selected_channels(&self, file_hash: &str) -> Result<Option<Vec<String>>> {
        let Some(dataset_id) = self.dataset_id(file_hash)? else {
            return Ok(None);
        };
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        let json: Option<String> = connection
            .query_row(
                "SELECT selected_channels_json FROM dataset_preferences WHERE dataset_id = ?1",
                [&dataset_id],
                |row| row.get(0),
            )
            .optional()?;
        match json {
            None => Ok(None),
            Some(value) => serde_json::from_str(&value)
                .map(Some)
                .map_err(|error| StoreError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error))),
        }
    }

    pub fn save_selected_channels(&self, file_hash: &str, channels: &[String]) -> Result<bool> {
        let Some(dataset_id) = self.dataset_id(file_hash)? else {
            return Ok(false);
        };
        let json = serde_json::to_string(channels)
            .map_err(|error| StoreError::Io(std::io::Error::other(error)))?;
        let connection = self.connection.lock().expect("telemetry store mutex poisoned");
        connection.execute(
            "INSERT INTO dataset_preferences(dataset_id, selected_channels_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(dataset_id) DO UPDATE SET selected_channels_json = excluded.selected_channels_json,
             updated_at = excluded.updated_at",
            params![dataset_id, json, unix_now()],
        )?;
        Ok(true)
    }
}

fn unix_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use cache_core::{CacheState, CachedChannelMeta, ChannelEntry, SourceIdentity};
    use telemetry_core::{ChannelDType, ChannelSource, SessionMeta};

    fn temp_path(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "scut-telemetry-store-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn manifest(hash: &str) -> CacheManifest {
        CacheManifest {
            version: cache_core::FORMAT_VERSION,
            identity: SourceIdentity { hash: hash.into(), mtime: 42, size: 128 },
            meta: SessionMeta {
                file_path: "D:/runs/test.csv".into(),
                file_type: "csv".into(),
                session: "Session A".into(),
                vehicle: "A004".into(),
                racer: "Driver One".into(),
                date: "2026-10-03".into(),
                start_time: "12:30:00".into(),
                duration: 12.5,
                ..Default::default()
            },
            channels: vec![ChannelEntry {
                meta: CachedChannelMeta {
                    dtype: ChannelDType::Numeric,
                    key: "Speed".into(),
                    name: "Speed".into(),
                    unit: "km/h".into(),
                    source: ChannelSource::Csv,
                    sample_rate_hz: 50.0,
                },
                raw: None,
                pyramid: None,
                full_count: 0,
                last_time: None,
            }],
            laps: Vec::new(),
            state: CacheState::Ready,
            error: None,
        }
    }

    #[test]
    fn upserts_manifest_and_searches_record_summary() {
        let root = temp_path("upsert");
        let store = TelemetryStore::open(&root.join("telemetry.db")).unwrap();
        store.upsert_manifest(&manifest(&"a".repeat(64)), "datasets/a").unwrap();
        store.upsert_manifest(&manifest(&"a".repeat(64)), "datasets/a").unwrap();

        let rows = store.list_records("driver").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_name, "test.csv");
        assert_eq!(rows[0].channel_count, 1);
        assert_eq!(store.list_records("").unwrap().len(), 1);
        assert_eq!(store.selected_channels(&"a".repeat(64)).unwrap(), None);
        assert!(store.save_selected_channels(&"a".repeat(64), &["Speed".into()]).unwrap());
        assert_eq!(store.selected_channels(&"a".repeat(64)).unwrap(), Some(vec!["Speed".into()]));
        assert!(store.set_record_note(&"a".repeat(64), "记录备注").unwrap());
        store.set_date_note("2026-10-03", "日期备注").unwrap();
        let rows = store.list_records("").unwrap();
        assert_eq!(rows[0].record_note, "记录备注");
        assert_eq!(rows[0].date_note, "日期备注");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn deletes_record_and_cascades_channel_rows() {
        let root = temp_path("delete");
        let store = TelemetryStore::open(&root.join("telemetry.db")).unwrap();
        store.upsert_manifest(&manifest(&"c".repeat(64)), "datasets/c").unwrap();
        assert!(store.delete_by_hash(&"c".repeat(64)).unwrap());
        assert!(!store.delete_by_hash(&"c".repeat(64)).unwrap());
        assert!(store.list_records("").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
