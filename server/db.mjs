import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const UPSERT_DATASET_SQL = `INSERT INTO datasets (
   file_hash, file_name, file_type, record_date, start_time, session,
   vehicle, racer, championship, duration, sample_rate_hz, file_size,
   source_mtime_unix, storage_key, is_archived, updated_at
 ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
 ON CONFLICT(file_hash) DO UPDATE SET
   file_name = EXCLUDED.file_name,
   file_type = EXCLUDED.file_type,
   record_date = EXCLUDED.record_date,
   start_time = EXCLUDED.start_time,
   session = EXCLUDED.session,
   vehicle = EXCLUDED.vehicle,
   racer = EXCLUDED.racer,
   championship = EXCLUDED.championship,
   duration = EXCLUDED.duration,
   sample_rate_hz = EXCLUDED.sample_rate_hz,
   file_size = EXCLUDED.file_size,
   source_mtime_unix = EXCLUDED.source_mtime_unix,
   storage_key = EXCLUDED.storage_key,
   is_archived = EXCLUDED.is_archived,
   updated_at = EXCLUDED.updated_at`;

export async function createDatabase(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);

  return {
    async close() {
      await pool.end();
    },
    async health() {
      await pool.query("SELECT 1");
      return "postgresql";
    },
    async listDatasets({ fileHash = null, includeArchived = false } = {}) {
      if (fileHash) {
        const result = await pool.query(
          `SELECT file_hash, file_name, file_type, record_date::text AS record_date, start_time, session,
                  vehicle, racer, championship, duration, sample_rate_hz, file_size,
                  source_mtime_unix, storage_key, is_archived, updated_at
             FROM datasets
            WHERE file_hash = $1 AND ($2::boolean OR is_archived = FALSE)
            ORDER BY record_date DESC, start_time DESC`,
          [fileHash, includeArchived],
        );
        return result.rows;
      }
      const result = await pool.query(
        `SELECT file_hash, file_name, file_type, record_date::text AS record_date, start_time, session,
                vehicle, racer, championship, duration, sample_rate_hz, file_size,
                source_mtime_unix, storage_key, is_archived, updated_at
           FROM datasets
          WHERE $1::boolean OR is_archived = FALSE
          ORDER BY record_date DESC, start_time DESC`,
        [includeArchived],
      );
      return result.rows;
    },
    async upsertDataset(dataset) {
      await this.upsertDatasets([dataset]);
    },
    async upsertDatasets(datasets) {
      const updated_at = Math.floor(Date.now() / 1000);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const dataset of datasets) {
          await client.query(UPSERT_DATASET_SQL, [
            dataset.file_hash,
            dataset.file_name,
            dataset.file_type,
            dataset.record_date,
            dataset.start_time,
            dataset.session,
            dataset.vehicle,
            dataset.racer,
            dataset.championship,
            dataset.duration,
            dataset.sample_rate_hz,
            dataset.file_size,
            dataset.source_mtime_unix,
            dataset.storage_key ?? null,
            Boolean(dataset.is_archived),
            updated_at,
          ]);
        }
        await client.query("COMMIT");
        return datasets.length;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async archiveDataset(fileHash, archived = true) {
      const result = await pool.query(
        "UPDATE datasets SET is_archived = $2, updated_at = $3 WHERE file_hash = $1 RETURNING file_hash, is_archived",
        [fileHash, archived, Math.floor(Date.now() / 1000)],
      );
      return result.rows[0] ?? null;
    },
    async listDateNotes() {
      const result = await pool.query("SELECT date_key::text AS date_key, note, updated_at FROM date_notes ORDER BY date_key DESC");
      return result.rows;
    },
    async getDateNote(dateKey) {
      const result = await pool.query("SELECT date_key::text AS date_key, note, updated_at FROM date_notes WHERE date_key = $1::date", [dateKey]);
      return result.rows[0] ?? { date_key: dateKey, note: "", updated_at: null };
    },
    async saveDateNote(dateKey, note) {
      if (note) {
        await pool.query(
          `INSERT INTO date_notes(date_key, note, updated_at) VALUES ($1::date, $2, $3)
           ON CONFLICT(date_key) DO UPDATE SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
          [dateKey, note, Math.floor(Date.now() / 1000)],
        );
      } else {
        await pool.query("DELETE FROM date_notes WHERE date_key = $1::date", [dateKey]);
      }
      return this.getDateNote(dateKey);
    },
  };
}
