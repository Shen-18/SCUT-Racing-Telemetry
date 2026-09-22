import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { decodeFrame } from "./frame";
import type {
  ImportStage,
  ImportStatus,
  FrameHeader,
  WindowFrame,
  RecordSummary,
  QueuedImport,
  ChannelMeta as BaseChannelMeta,
  DatasetMeta as BaseDatasetMeta,
  SampleRange,
} from "./types";

export type { RecordSummary, QueuedImport };

export type ChannelMeta = BaseChannelMeta & { ready?: boolean };
export type DatasetChannel = ChannelMeta;
export type DatasetMeta = Omit<BaseDatasetMeta, "channels"> & {
  channels: ChannelMeta[];
};

export type {
  ImportStage,
  ImportStatus,
  FrameHeader,
  WindowFrame,
};

export interface CacheRootStatus {
  cache_bytes: number;
  db_path: string;
  mem_rss_bytes: number;
  active_jobs: number;
}

export interface CmdError {
  code: string;
  message: string;
}

export interface LapInfo {
  index: number;
  start: number;
  duration: number;
}

export interface ChannelStats {
  min: number;
  max: number;
  mean: number;
  std_dev: number;
  [key: string]: unknown;
}

export interface Comment {
  id: number;
  record_id: number;
  t: number;
  text: string;
  [key: string]: unknown;
}

export const clientApi = {
  invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return tauriInvoke<T>(command, args);
  },
};

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return clientApi.invoke<T>(command, args);
}

export { decodeFrame };

export function startImport(path: string): Promise<number> {
  return invoke<number>("start_import", { path });
}

export function startImportBatch(paths: string[], recursive = false): Promise<number[]> {
  return invoke<number[]>("start_import_batch", { paths, recursive });
}

export function importStatus(jobId: number): Promise<ImportStatus> {
  return invoke<ImportStatus>("import_status", { jobId });
}

export function cancelImport(jobId: number): Promise<void> {
  return invoke<void>("cancel_import", { jobId });
}

export function prioritizeImport(jobId: number, channels: string[]): Promise<void> {
  return invoke<void>("prioritize_import", { jobId, channels });
}

export function openDataset(fileHash: string): Promise<DatasetMeta> {
  return invoke<DatasetMeta>("open_dataset", { fileHash });
}

export function closeDataset(id: number): Promise<void> {
  return invoke<void>("close_dataset", { id });
}

export function datasetMeta(id: number): Promise<DatasetMeta> {
  return invoke<DatasetMeta>("dataset_meta", { id });
}

export function sampleRange(id: number, channels: string[] = []): Promise<SampleRange | null> {
  return invoke<SampleRange | null>("sample_range", { id, channels });
}

export function sampleOverlap(id: number, channels: string[] = []): Promise<SampleRange | null> {
  return invoke<SampleRange | null>("sample_overlap", { id, channels });
}

export async function windowSeries(
  id: number,
  channel: string,
  start: number,
  end: number,
  pixels: number,
  generation: number
): Promise<WindowFrame> {
  const bytes = await invoke<ArrayBuffer | Uint8Array | number[]>("window_series", {
    id,
    channel,
    start,
    end,
    pixels,
    generation,
  });
  const frame = decodeFrame(bytes, generation);
  if (!frame) {
    throw new Error(`Generation mismatch: expected ${generation}`);
  }
  return frame;
}

export function cursorValues(id: number, channels: string[], t: number): Promise<number[]> {
  return invoke<number[]>("cursor_values", { id, channels, t });
}

export function getLaps(id: number): Promise<LapInfo[]> {
  return invoke<LapInfo[]>("laps", { id });
}

export function getStats(
  id: number,
  channels: string[],
  start: number,
  end: number
): Promise<Record<string, ChannelStats>> {
  return invoke<Record<string, ChannelStats>>("stats", { id, channels, start, end });
}

export function importFiles(paths: string[]): Promise<QueuedImport[]> {
  return invoke<QueuedImport[]>("import_files", { paths });
}

export function pickImportFiles(): Promise<string[]> {
  return invoke<string[]>("pick_import_files");
}

/** 单条导出结果（export_records 返回值）。 */
export interface ExportOutcome {
  file_hash: string;
  file_name: string;
  status: "exported" | "missing" | "failed" | string;
  message?: string | null;
}

/**
 * 订阅 Tauri 原生拖放事件（WebView2 会拦截 HTML5 拖放）。
 * IPC 只允许经过本模块，故对外只暴露语义化回调。
 */
export function onFileDrop(handlers: {
  onEnter(): void;
  onLeave(): void;
  onDrop(paths: string[]): void;
}): Promise<() => void> {
  return import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload as { type: string; paths?: string[] };
      if (payload.type === "enter" || payload.type === "over") handlers.onEnter();
      else if (payload.type === "drop") handlers.onDrop(payload.paths ?? []);
      else handlers.onLeave();
    })
  );
}

/** 保存单个 CSV 的文件对话框（分析页"导出选中通道"）。 */
export function pickExportFile(suggestedName: string): Promise<string | null> {
  return invoke<string | null>("pick_export_file", { suggestedName });
}

export function pickExportFolder(): Promise<string | null> {
  return invoke<string | null>("pick_export_folder");
}

export function exportRecords(hashes: string[], dir: string): Promise<ExportOutcome[]> {
  return invoke<ExportOutcome[]>("export_records", { hashes, dir });
}

export function listRecords(query = ""): Promise<RecordSummary[]> {
  return invoke<RecordSummary[]>("list_records", { query });
}

export function deleteRecord(recordId: number): Promise<void> {
  return invoke<void>("delete_record", { recordId });
}

export function exportCsv(
  id: number,
  channels: string[],
  start: number,
  end: number,
  outPath: string
): Promise<void> {
  return invoke<void>("export_csv", { id, channels, start, end, outPath });
}

export function getComments(recordId: number): Promise<Comment[]> {
  return invoke<Comment[]>("comments", { recordId });
}

export function addComment(recordId: number, t: number, text: string): Promise<number> {
  return invoke<number>("add_comment", { recordId, t, text });
}

export function deleteComment(id: number): Promise<void> {
  return invoke<void>("delete_comment", { id });
}

export function saveLayout(name: string, json: string): Promise<void> {
  return invoke<void>("save_layout", { name, json });
}

export function loadLayout(name: string): Promise<string | null> {
  return invoke<string | null>("load_layout", { name });
}

export function estimateOffset(
  idA: number,
  idB: number,
  channel: string,
  start: number,
  end: number
): Promise<number> {
  return invoke<number>("estimate_offset", { idA, idB, channel, start, end });
}

export function purgeCache(fileHash?: string | null): Promise<number> {
  return invoke<number>("purge_cache", { fileHash: fileHash ?? null });
}

export function cacheRootStatus(): Promise<CacheRootStatus> {
  return invoke<CacheRootStatus>("cache_root_status");
}

/**
 * Selects the default speed channel from a list of channel metadata.
 * Prioritizes real physical speed channels (e.g. "VehSpd", "Speed"),
 * then real GPS speed (DerivedGps), then other standard speed channels,
 * and deprioritizes AiM Interpolated synthetic channels.
 */
export function selectDefaultSpeedChannel(
  channels?: Array<{ key: string; name?: string; source?: string }> | null
): string | undefined {
  if (!channels || channels.length === 0) {
    return undefined;
  }

  const containsSpeed = (s?: string) => Boolean(s && /(?:speed|spd)/i.test(s));
  const isDistance = (s?: string) => Boolean(s && /distance/i.test(s));

  const speedCandidates = channels.filter((c) => {
    const hasSpeedWord = containsSpeed(c.key) || containsSpeed(c.name);
    const hasDistanceWord = isDistance(c.key) || isDistance(c.name);
    return hasSpeedWord && !hasDistanceWord;
  });

  if (speedCandidates.length === 0) {
    return channels[0].key;
  }

  const getScore = (c: { key: string; name?: string; source?: string }): number => {
    const key = c.key || "";
    const name = c.name || "";
    const source = (c.source || "").toLowerCase();

    // AiM Interpolated channels are deprioritized (synthetic, 10Hz quantized).
    if (name.includes("(AiM Interpolated)") || key.includes("(AiM Interpolated)")) {
      return 90;
    }

    // 1. Physical vehicle speed (Standard CAN bus speed channels)
    if (
      (source === "standard" || source === "aim") &&
      (name.toLowerCase() === "speed" || key.toLowerCase() === "speed" ||
       name.toLowerCase() === "vehspd" || key.toLowerCase() === "vehspd")
    ) {
      return 1;
    }

    // 2. Other standard/AiM speed channels (e.g. "AGX Speed")
    if (source === "standard" || source === "aim") {
      return 10;
    }

    // 3. Real GPS Speed (derived from hardware ECEF)
    if (
      source === "derivedgps" ||
      name.toLowerCase() === "gps speed" ||
      key.toLowerCase() === "gps speed"
    ) {
      return 20;
    }

    // 4. Other speed channels
    return 30;
  };

  speedCandidates.sort((a, b) => getScore(a) - getScore(b));
  return speedCandidates[0].key;
}

export function selectActiveChannel(
  channels?: Array<{ key: string; name?: string; source?: string }> | null,
  checkedChannels: string[] = []
): string {
  if (!channels || channels.length === 0) return "";
  const available = new Set(channels.map((channel) => channel.key));
  const mostRecentlyChecked = [...checkedChannels].reverse().find((key) => available.has(key));
  return mostRecentlyChecked ?? selectDefaultSpeedChannel(channels) ?? channels[0].key;
}
