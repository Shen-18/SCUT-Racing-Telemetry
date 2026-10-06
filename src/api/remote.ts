import type { RecordSummary } from "./types";

export interface RemoteHealth {
  ok: boolean;
  service: string;
  database: string;
  time: string;
}

export interface RemoteDateNote {
  date_key: string;
  note: string;
  updated_at: number | null;
}

export function normalizeRemoteBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export async function checkRemoteHealth(baseUrl: string): Promise<RemoteHealth> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${normalizeRemoteBaseUrl(baseUrl)}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    return (await response.json()) as RemoteHealth;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function listRemoteDateNotes(baseUrl: string): Promise<RemoteDateNote[]> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${normalizeRemoteBaseUrl(baseUrl)}/api/v1/date-notes`, { signal: controller.signal });
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    const body = (await response.json()) as { date_notes?: RemoteDateNote[] };
    return body.date_notes ?? [];
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export interface RemoteDatasetIndex {
  file_hash: string;
  file_name: string;
  file_type: string;
  record_date: string;
  start_time: string;
  session: string;
  vehicle: string;
  racer: string;
  championship: string;
  duration: number;
  sample_rate_hz: number;
  file_size: number;
  source_mtime_unix: number;
}

export interface RemoteSyncResult {
  synced: number;
  skipped: number;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 云端 record_date 是 DATE 列；日期无法解析的记录留本地，不阻塞整包同步
export function toRemoteDatasetIndex(record: RecordSummary): RemoteDatasetIndex | null {
  const recordDate = record.record_date.trim();
  if (!DATE_KEY_PATTERN.test(recordDate)) return null;
  return {
    file_hash: record.file_hash,
    file_name: record.file_name,
    file_type: record.file_type,
    record_date: recordDate,
    start_time: record.start_time,
    session: record.session,
    vehicle: record.vehicle,
    racer: record.racer,
    championship: "",
    duration: record.duration,
    sample_rate_hz: 0,
    file_size: record.file_size,
    source_mtime_unix: record.source_mtime_unix,
  };
}

export async function syncDatasetIndex(baseUrl: string, records: readonly RecordSummary[]): Promise<RemoteSyncResult> {
  const origin = normalizeRemoteBaseUrl(baseUrl);
  if (!origin) throw new Error("未配置云端服务器地址");
  const datasets = records
    .map(toRemoteDatasetIndex)
    .filter((item): item is RemoteDatasetIndex => item !== null);
  if (datasets.length === 0) return { synced: 0, skipped: records.length };

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${origin}/api/v1/admin/datasets/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ datasets }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    const body = (await response.json()) as { count?: number };
    return {
      synced: typeof body.count === "number" ? body.count : datasets.length,
      skipped: records.length - datasets.length,
    };
  } finally {
    globalThis.clearTimeout(timer);
  }
}
