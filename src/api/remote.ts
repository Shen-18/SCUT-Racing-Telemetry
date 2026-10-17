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

export function readRemoteBaseUrl(): string {
  try {
    if (typeof localStorage === "undefined") return "";
    return normalizeRemoteBaseUrl(localStorage.getItem("scut.remote-server-url") || "");
  } catch {
    return "";
  }
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

export async function listRemoteDateNotes(baseUrl: string, token?: string): Promise<RemoteDateNote[]> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(`${normalizeRemoteBaseUrl(baseUrl)}/api/v1/date-notes`, {
      signal: controller.signal,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (response.status === 401) throw new Error("访问密钥无效或已被吊销");
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    const body = (await response.json()) as { date_notes?: RemoteDateNote[] };
    return body.date_notes ?? [];
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** 云端数据集索引条目（GET /api/v1/datasets 返回行，只取同步所需字段） */
export interface RemoteDatasetFile {
  file_hash: string;
  file_name: string;
  file_type: string;
  file_size: number;
  record_date: string;
  racer: string;
  vehicle: string;
  session: string;
}

export async function listRemoteDatasets(baseUrl: string, token: string): Promise<RemoteDatasetFile[]> {
  const origin = normalizeRemoteBaseUrl(baseUrl);
  if (!origin) throw new Error("未配置云端服务器地址");
  if (!token.trim()) throw new Error("未填写访问密钥");
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${origin}/api/v1/datasets`, {
      signal: controller.signal,
      headers: { authorization: `Bearer ${token.trim()}` },
    });
    if (response.status === 401) throw new Error("访问密钥无效或已被吊销");
    if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
    const body = (await response.json()) as { datasets?: RemoteDatasetFile[] };
    return body.datasets ?? [];
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** 云端有而本地没有的记录（按内容哈希增量比对；云端重复哈希只保留第一条） */
export function diffRemoteDatasets(
  cloud: readonly RemoteDatasetFile[],
  localHashes: readonly string[] | ReadonlySet<string>
): RemoteDatasetFile[] {
  const have = localHashes instanceof Set ? localHashes : new Set(localHashes);
  const seen = new Set<string>();
  const fresh: RemoteDatasetFile[] = [];
  for (const item of cloud) {
    if (!item || typeof item.file_hash !== "string" || item.file_hash.length !== 64) continue;
    if (have.has(item.file_hash) || seen.has(item.file_hash)) continue;
    seen.add(item.file_hash);
    fresh.push(item);
  }
  return fresh;
}
