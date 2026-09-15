import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { decodeFrame } from "./frame";
import type {
  ImportStage,
  ImportStatus,
  FrameHeader,
  WindowFrame,
  ChannelMeta as BaseChannelMeta,
  DatasetMeta as BaseDatasetMeta,
} from "./types";

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

export interface Record_ {
  id: number;
  file_hash: string;
  file_name?: string;
  session?: string;
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

export function listRecords(query = ""): Promise<Record_[]> {
  return invoke<Record_[]>("list_records", { query });
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
 * Prioritizes official speed channels (e.g. "GPS Speed (AiM Interpolated)"),
 * falls back to raw GPS speed (e.g. "GPS Speed"), then other channels containing "speed",
 * and finally falls back to the first channel if no speed channel exists.
 */
export function selectDefaultSpeedChannel(
  channels?: Array<{ key: string; name?: string; source?: string }> | null
): string | undefined {
  if (!channels || channels.length === 0) {
    return undefined;
  }

  const containsSpeed = (s?: string) => Boolean(s && /speed/i.test(s));
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

    // 1. Official AiM interpolated GPS Speed or exact Speed channel
    if (
      name.includes("(AiM Interpolated)") ||
      key.includes("(AiM Interpolated)") ||
      ((source === "gps" || source === "aim" || source === "standard") &&
        (name.toLowerCase() === "gps speed (aim interpolated)" ||
          name.toLowerCase() === "speed" ||
          key.toLowerCase() === "speed"))
    ) {
      return 1;
    }

    // 2. Official standard or GPS channels with speed
    if (source === "gps" || source === "standard" || source === "aim") {
      return 10;
    }

    // 3. Raw GPS Speed (derived GPS)
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
