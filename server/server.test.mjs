import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DATABASE_URL, resolveServerConfig } from "./config.mjs";
import { safeUploadName } from "./storage.mjs";
import { normalizeDatasetInput, normalizeDatasetInputs } from "./validation.mjs";

test("server config uses the PostgreSQL connection string and local defaults", () => {
  assert.deepEqual(
    resolveServerConfig({}).databaseUrl,
    DEFAULT_DATABASE_URL,
  );
  assert.deepEqual(
    resolveServerConfig({ SCUT_SYNC_PORT: "9123", SCUT_DATABASE_URL: "postgres://demo" }),
    {
      port: 9123,
      databaseUrl: "postgres://demo",
      host: "127.0.0.1",
    },
  );
});

test("dataset input validates the metadata required by the cloud index", () => {
  assert.throws(
    () => normalizeDatasetInput({ file_hash: "only-hash" }),
    /缺少必要字段/,
  );

  const dataset = normalizeDatasetInput({
    file_hash: "abc123",
    file_name: "session.csv",
    file_type: "csv",
    record_date: "2026-10-05",
    start_time: "09:30:00",
    session: "A",
    vehicle: "A04_AF26",
    racer: "Zicheng Yang",
    championship: "SCUT Racing",
    duration: "12.5",
    sample_rate_hz: "500",
    file_size: "1024",
    source_mtime_unix: "1760000000",
  });

  assert.equal(dataset.duration, 12.5);
  assert.equal(dataset.sample_rate_hz, 500);
  assert.equal(dataset.file_size, 1024);
  assert.equal(dataset.source_mtime_unix, 1760000000);
});

test("uploaded file names are reduced to safe local names", () => {
  assert.equal(safeUploadName("..\\raw\\session 01.xrk"), "session_01.xrk");
  assert.equal(safeUploadName(""), "upload.bin");
});

test("dataset fields may be empty strings but must exist", () => {
  const dataset = normalizeDatasetInput({
    file_hash: "abc123",
    file_name: "session.xrk",
    file_type: "xrk",
    record_date: "2026-10-05",
    start_time: "09:30:00",
    session: "",
    vehicle: "",
    racer: "",
    championship: "",
  });
  assert.equal(dataset.vehicle, "");
  assert.equal(dataset.sample_rate_hz, 0);

  assert.throws(
    () => normalizeDatasetInput({ file_hash: "abc123", file_name: "a.xrk" }),
    /缺少必要字段/,
  );
});

test("bulk sync validates the whole list before any write", () => {
  const valid = { file_hash: "h1", file_name: "a.xrk", file_type: "xrk", record_date: "2026-10-05", start_time: "09:30:00", session: "A", vehicle: "V", racer: "R", championship: "" };
  assert.equal(normalizeDatasetInputs([valid, { ...valid, file_hash: "h2" }]).length, 2);

  assert.throws(() => normalizeDatasetInputs("nope"), /必须是数组/);
  assert.throws(() => normalizeDatasetInputs([]), /不能为空/);
  assert.throws(() => normalizeDatasetInputs([valid, { ...valid, file_hash: 42 }]), /缺少必要字段/);
});
