CREATE TABLE IF NOT EXISTS datasets (
  file_hash TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  record_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  session TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  racer TEXT NOT NULL,
  championship TEXT NOT NULL,
  duration DOUBLE PRECISION NOT NULL DEFAULT 0,
  sample_rate_hz DOUBLE PRECISION NOT NULL DEFAULT 0,
  file_size BIGINT NOT NULL DEFAULT 0,
  source_mtime_unix BIGINT NOT NULL DEFAULT 0,
  storage_key TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS date_notes (
  date_key DATE PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_datasets_record_date ON datasets(record_date);
CREATE INDEX IF NOT EXISTS idx_datasets_updated_at ON datasets(updated_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_tokens (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at BIGINT NOT NULL,
  last_used_at BIGINT,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS admin_accounts (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS account_id INTEGER;
