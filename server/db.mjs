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
    async createAdminSession(tokenHash, accountId, expiresAt) {
      await pool.query(
        "INSERT INTO admin_sessions(token_hash, account_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT(token_hash) DO UPDATE SET account_id = EXCLUDED.account_id, expires_at = EXCLUDED.expires_at",
        [tokenHash, accountId, expiresAt],
      );
    },
    async getAdminSession(tokenHash) {
      const result = await pool.query(
        "SELECT token_hash, account_id, expires_at FROM admin_sessions WHERE token_hash = $1",
        [tokenHash],
      );
      return result.rows[0] ?? null;
    },
    async deleteAdminSession(tokenHash) {
      await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]);
    },
    async purgeExpiredAdminSessions(now) {
      await pool.query("DELETE FROM admin_sessions WHERE expires_at < $1", [now]);
    },
    async deleteAdminSessionsForAccount(accountId, exceptHash) {
      await pool.query("DELETE FROM admin_sessions WHERE account_id = $1 AND token_hash <> $2", [accountId, exceptHash]);
    },
    async adminAccountsEmpty() {
      const result = await pool.query("SELECT COUNT(*)::int AS n FROM admin_accounts");
      return (result.rows[0]?.n ?? 0) === 0;
    },
    async createAdminAccount({ username, passwordHash }) {
      const result = await pool.query(
        "INSERT INTO admin_accounts(username, password_hash, created_at) VALUES ($1, $2, $3) RETURNING id, username, created_at",
        [username, passwordHash, Math.floor(Date.now() / 1000)],
      );
      return result.rows[0];
    },
    async getAdminAccount(username) {
      const result = await pool.query("SELECT id, username, password_hash, created_at FROM admin_accounts WHERE username = $1", [username]);
      return result.rows[0] ?? null;
    },
    async getAdminAccountById(id) {
      const result = await pool.query("SELECT id, username, password_hash, created_at FROM admin_accounts WHERE id = $1", [id]);
      return result.rows[0] ?? null;
    },
    async listAdminAccounts() {
      const result = await pool.query("SELECT id, username, created_at FROM admin_accounts ORDER BY id");
      return result.rows;
    },
    async deleteAdminAccount(id) {
      await pool.query("BEGIN");
      try {
        const result = await pool.query("DELETE FROM admin_accounts WHERE id = $1 RETURNING id", [id]);
        await pool.query("DELETE FROM admin_sessions WHERE account_id = $1", [id]);
        await pool.query("COMMIT");
        return result.rows[0] ?? null;
      } catch (error) {
        await pool.query("ROLLBACK");
        throw error;
      }
    },
    async countAdminAccounts() {
      const result = await pool.query("SELECT COUNT(*)::int AS n FROM admin_accounts");
      return result.rows[0]?.n ?? 0;
    },
    async updateAdminPassword(accountId, passwordHash) {
      const result = await pool.query(
        "UPDATE admin_accounts SET password_hash = $2 WHERE id = $1 RETURNING id",
        [accountId, passwordHash],
      );
      return result.rows[0] ?? null;
    },
    async createClientToken({ name, token }) {
      const now = Math.floor(Date.now() / 1000);
      const result = await pool.query(
        "INSERT INTO client_tokens(name, token, created_at) VALUES ($1, $2, $3) RETURNING id, name, token, created_at, last_used_at, revoked_at",
        [name, token, now],
      );
      return result.rows[0];
    },
    async listClientTokens() {
      const result = await pool.query(
        "SELECT id, name, token, created_at, last_used_at, revoked_at FROM client_tokens ORDER BY id DESC",
      );
      return result.rows;
    },
    async revokeClientToken(id) {
      const result = await pool.query(
        "UPDATE client_tokens SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL RETURNING id",
        [id, Math.floor(Date.now() / 1000)],
      );
      return result.rows[0] ?? null;
    },
    async getClientToken(token) {
      const result = await pool.query(
        "SELECT id, name, token, created_at, last_used_at, revoked_at FROM client_tokens WHERE token = $1",
        [token],
      );
      return result.rows[0] ?? null;
    },
    async touchClientToken(id) {
      await pool.query("UPDATE client_tokens SET last_used_at = $2 WHERE id = $1", [id, Math.floor(Date.now() / 1000)]);
    },
    async getDatasetByHash(fileHash) {
      const result = await pool.query(
        `SELECT file_hash, file_name, file_type, record_date::text AS record_date, start_time, session,
                vehicle, racer, championship, duration, sample_rate_hz, file_size,
                source_mtime_unix, storage_key, is_archived, updated_at
           FROM datasets WHERE file_hash = $1`,
        [fileHash],
      );
      return result.rows[0] ?? null;
    },
    async deleteDataset(fileHash) {
      const result = await pool.query(
        "DELETE FROM datasets WHERE file_hash = $1 RETURNING file_hash, storage_key",
        [fileHash],
      );
      return result.rows[0] ?? null;
    },
  };
}
