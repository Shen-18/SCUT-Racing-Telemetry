import { create } from "zustand";
import type { DatasetMeta, ImportStatus, WindowFrame, ImportStage } from "../api/client";
import * as client from "../api/client";
import { getDatasetDuration } from "../api/dataset";
import { diffRemoteDatasets, listRemoteDatasets, normalizeRemoteBaseUrl, type RemoteDatasetFile } from "../api/remote";
import { clampToSampleRange, clampWindowToSampleRange, type SampleRange } from "../utils/sampleRange";

export type CloudSyncPhase = "idle" | "checking" | "confirm" | "downloading" | "importing" | "done" | "error";

export interface CloudSyncState {
  phase: CloudSyncPhase;
  /** 本次检查发现的云端新记录（完成后保留，提示条可一键重下） */
  newFiles: RemoteDatasetFile[];
  done: number;
  total: number;
  currentName: string;
  message: string;
  lastSyncAt: number | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function remoteBaseUrl(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return normalizeRemoteBaseUrl(localStorage.getItem("scut.remote-server-url") || "");
  } catch {
    return "";
  }
}

/** 轮询导入作业直到终态；进度经由 importJobs 喂给底部进度条 */
async function waitForImportJob(jobId: number): Promise<ImportStatus> {
  for (;;) {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
    const status = await client.importStatus(jobId);
    useAppStore.getState().updateImportStatus(status);
    if (
      status.stage === "Ready" ||
      status.stage === "Failed" ||
      status.stage === "Cancelled" ||
      status.stage === "Duplicate"
    ) {
      return status;
    }
  }
}

export interface AppState {
  dataset: DatasetMeta | null;
  checkedChannels: string[];
  channelOrder: string[];
  window: { start: number; end: number };
  activeRange: SampleRange | null;
  cursorT: number;
  theme: "dark" | "light";
  layoutPreset: string;
  generation: number;
  importJobs: Record<number, ImportStatus>;
  currentFrame: WindowFrame | null;
  openingFileHash: string | null;
  leftWidth: number;
  rightWidth: number;
  view: "library" | "analysis" | "overlay" | "settings";
  trackMapSplitterEnabled: boolean;
  rememberSelectedChannels: boolean;
  overlayRecordHash: string | null;
  overlayStep: "select" | "operations";
  playing: boolean;
  detailFocusKey: string | null;

  remoteToken: string;
  remoteAutosync: boolean;
  cloudSync: CloudSyncState;
  /** 同步导入进行中：updateImportStatus 暂停"导入完成自动打开分析页"，避免批量同步时页面被反复劫走 */
  cloudSyncBusy: boolean;

  openDataset(fileHash: string): Promise<void>;
  setView(view: "library" | "analysis" | "overlay" | "settings"): void;
  setTrackMapSplitterEnabled(enabled: boolean): void;
  setRememberSelectedChannels(enabled: boolean): void;
  enterOverlay(fileHash?: string): void;
  setOverlayRecord(fileHash: string | null): void;
  setOverlayStep(step: "select" | "operations"): void;
  setPlaying(playing: boolean): void;
  setDetailFocusKey(key: string | null): void;
  setWindow(w: { start: number; end: number }): void;
  setZoomWindow(w: { start: number; end: number }): void;
  setActiveRange(range: SampleRange | null): void;
  setCursor(t: number): void;
  setLeftWidth(width: number): void;
  setRightWidth(width: number): void;
  toggleChannel(key: string): void;
  toggleChannelAndPrioritize(key: string): Promise<void>;
  reorderChannels(order: string[]): void;
  setTheme(t: "dark" | "light"): void;
  bumpGeneration(): void;
  startImport(path: string): Promise<number>;
  trackImport(jobId: number): void;
  prioritizeImport(jobId: number, channels: string[]): Promise<void>;
  applyFrame(frame: WindowFrame): boolean;
  updateImportStatus(status: ImportStatus): void;

  setRemoteToken(token: string): void;
  setRemoteAutosync(enabled: boolean): void;
  /** 拉云端索引与本地比对；auto=true 时发现新记录直接下载（启动静默），否则停在 confirm 等确认 */
  checkCloudUpdates(options?: { auto?: boolean }): Promise<void>;
  runCloudSync(): Promise<void>;
  dismissCloudSync(): void;
  /** 忽略本轮发现的新记录（清空待下载清单，提示条消失） */
  ignoreCloudSync(): void;
}

export const LEFT_WIDTH_RANGE = { min: 220, max: 420, default: 280 } as const;
export const RIGHT_WIDTH_RANGE = { min: 240, max: 480, default: 310 } as const;

export function clampColumnWidth(width: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(width)) return range.min;
  return Math.max(range.min, Math.min(range.max, Math.round(width)));
}

export function isNonTerminalImportStage(stage: ImportStage): boolean {
  return (
    stage === "ReadingMetadata" ||
    stage === "ReadingChannels" ||
    stage === "BuildingRawCache" ||
    stage === "BuildingPyramid"
  );
}

function sameChannelSelection(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const expected = new Set(b);
  return a.every((key) => expected.has(key));
}

function readTrackMapSplitterEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem("scut.track-map-splitter") === "true";
  } catch {
    return false;
  }
}

function readRememberSelectedChannels(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem("scut.remember-selected-channels") === "true";
  } catch {
    return false;
  }
}

function readRemoteToken(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem("scut.remote-token") || "";
  } catch {
    return "";
  }
}

function readRemoteAutosync(): boolean {
  if (typeof localStorage === "undefined") return true;
  try {
    return localStorage.getItem("scut.remote-autosync") !== "false";
  } catch {
    return true;
  }
}

async function datasetSampleRange(id: number): Promise<SampleRange | null> {
  // The cursor/timeline activity area belongs to the dataset, not to the
  // currently selected channel.  Individual channels can legitimately start
  // later; their charts/cursor values remain empty until their first sample.
  const range = await client.sampleRange(id, []);
  if (!range) return null;
  // The session timeline starts at t=0. Keep the raw last timestamp as the
  // authoritative end; no channel samples are synthesized before their
  // actual first sample.
  return { start: 0, end: range.end };
}

export const useAppStore = create<AppState>((set, get) => ({
  dataset: null,
  checkedChannels: [],
  channelOrder: [],
  window: { start: 0, end: 1 },
  activeRange: null,
  cursorT: 0,
  theme: "dark",
  layoutPreset: "default",
  generation: 0,
  importJobs: {},
  currentFrame: null,
  openingFileHash: null,
  playing: false,
  detailFocusKey: null,
  leftWidth: LEFT_WIDTH_RANGE.default,
  rightWidth: RIGHT_WIDTH_RANGE.default,
  view: "library",
  overlayRecordHash: null,
  overlayStep: "select",
  trackMapSplitterEnabled: readTrackMapSplitterEnabled(),
  rememberSelectedChannels: readRememberSelectedChannels(),
  remoteToken: readRemoteToken(),
  remoteAutosync: readRemoteAutosync(),
  cloudSync: { phase: "idle", newFiles: [], done: 0, total: 0, currentName: "", message: "", lastSyncAt: null },
  cloudSyncBusy: false,

  bumpGeneration() {
    set((state) => ({ generation: state.generation + 1 }));
  },

  setWindow(w: { start: number; end: number }) {
    set((state) => ({
      window: clampWindowToSampleRange(w, state.activeRange),
      generation: state.generation + 1,
    }));
  },

  setZoomWindow(w: { start: number; end: number }) {
    set((state) => {
      const nextWindow = clampWindowToSampleRange(w, state.activeRange);
      return {
        window: nextWindow,
        cursorT: Math.max(nextWindow.start, Math.min(nextWindow.end, state.cursorT)),
        generation: state.generation + 1,
      };
    });
  },

  setView(view: "library" | "analysis" | "overlay" | "settings") {
    // 切视图即暂停播放，避免离开分析页后游标继续跑
    set({ view, playing: false });
  },

  setTrackMapSplitterEnabled(enabled: boolean) {
    set({ trackMapSplitterEnabled: enabled });
    try {
      localStorage.setItem("scut.track-map-splitter", String(enabled));
    } catch {
      // Embedded webviews may disable local storage; the current session still works.
    }
  },

  setRememberSelectedChannels(enabled: boolean) {
    set({ rememberSelectedChannels: enabled });
    try {
      localStorage.setItem("scut.remember-selected-channels", String(enabled));
    } catch {
      // Embedded webviews may disable local storage; the current session still works.
    }
  },

  enterOverlay(fileHash?: string) {
    set({
      view: "overlay",
      playing: false,
      overlayRecordHash: fileHash ?? null,
      overlayStep: "select",
    });
  },

  setOverlayRecord(fileHash: string | null) {
    set({ overlayRecordHash: fileHash });
  },

  setOverlayStep(step: "select" | "operations") {
    set({ overlayStep: step });
  },

  setPlaying(playing: boolean) {
    set({ playing });
  },

  setDetailFocusKey(key: string | null) {
    set({ detailFocusKey: key });
  },

  setLeftWidth(width: number) {
    set({ leftWidth: clampColumnWidth(width, LEFT_WIDTH_RANGE) });
  },

  setRightWidth(width: number) {
    set({ rightWidth: clampColumnWidth(width, RIGHT_WIDTH_RANGE) });
  },

  setActiveRange(range: SampleRange | null) {
    set((state) => {
      const nextWindow = clampWindowToSampleRange(state.window, range);
      const sameRange = state.activeRange?.start === range?.start && state.activeRange?.end === range?.end;
      const sameWindow = state.window.start === nextWindow.start && state.window.end === nextWindow.end;
      if (sameRange && sameWindow) return state;
      return {
        activeRange: range,
        window: nextWindow,
        cursorT: clampToSampleRange(state.cursorT, range),
        generation: sameWindow ? state.generation : state.generation + 1,
      };
    });
  },

  setCursor(t: number) {
    set((state) => ({ cursorT: clampToSampleRange(t, state.activeRange) }));
  },

  toggleChannel(key: string) {
    set((state) => {
      const exists = state.checkedChannels.includes(key);
      const checkedChannels = exists
        ? state.checkedChannels.filter((k) => k !== key)
        : [...state.checkedChannels, key];
      return { checkedChannels };
    });
    const dataset = get().dataset;
    if (!dataset) return;
    const selected = get().checkedChannels;
    if (get().rememberSelectedChannels) {
      void client.saveSelectedChannels(dataset.file_hash, selected).catch(() => {
        // 保存失败不阻断当前分析，下一次打开仍使用默认选择。
      });
    }
    get().setActiveRange(null);
    if (selected.length === 0) return;
    void datasetSampleRange(dataset.id).then((range) => {
      const state = get();
      if (state.dataset?.id !== dataset.id || !sameChannelSelection(state.checkedChannels, selected)) {
        return;
      }
      state.setActiveRange(range);
    }).catch(() => {
      // A channel can still be building during an import. Keep the metadata
      // duration as a temporary fallback until the next selection/open.
    });
  },

  async toggleChannelAndPrioritize(key: string): Promise<void> {
    get().toggleChannel(key);
    const isNowChecked = get().checkedChannels.includes(key);
    if (!isNowChecked) return;

    const activeJob = Object.values(get().importJobs).find((j) =>
      j && isNonTerminalImportStage(j.stage)
    );
    if (activeJob) {
      await get().prioritizeImport(activeJob.job_id, [key]);
    }
  },

  reorderChannels(order: string[]) {
    set({ channelOrder: order });
    const dataset = get().dataset;
    if (dataset && get().rememberSelectedChannels) {
      void client.saveSelectedChannels(dataset.file_hash, get().checkedChannels).catch(() => undefined);
    }
  },

  setTheme(t: "dark" | "light") {
    set({ theme: t });
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", t);
    }
  },

  applyFrame(frame: WindowFrame): boolean {
    if (frame.header.generation !== get().generation) {
      // Stale / expired frame: discard
      return false;
    }
    set({ currentFrame: frame });
    return true;
  },

  async openDataset(fileHash: string): Promise<void> {
    const meta = await client.openDataset(fileHash);
    const channels = meta.channels || [];
    const channelKeys = channels.map((c) => c.key);
    const defaultSpeedKey = client.selectDefaultSpeedChannel(channels);
    let savedSelection: string[] | null = null;
    if (get().rememberSelectedChannels) {
      try {
        savedSelection = await client.selectedChannels(fileHash);
      } catch {
        // Older installations may not have the preference command yet.
      }
    }
    const savedKeys = savedSelection?.filter((key) => channelKeys.includes(key)) ?? [];
    const initialChecked = savedSelection !== null
      ? savedKeys
      : defaultSpeedKey
      ? [defaultSpeedKey]
      : channelKeys.length > 0
        ? [channelKeys[0]]
        : [];
    const duration = getDatasetDuration(meta);
    let initialRange: SampleRange | null = null;
    try {
      initialRange = await datasetSampleRange(meta.id);
    } catch {
      // Partially-built caches may not expose a range yet.
    }

    set((state) => ({
      dataset: meta,
      checkedChannels: initialChecked,
      channelOrder: channelKeys,
      window: clampWindowToSampleRange({ start: 0, end: duration }, initialRange),
      activeRange: initialRange,
      generation: state.generation + 1,
      currentFrame: null,
      openingFileHash: null,
      view: "analysis",
    }));
  },

  async startImport(path: string): Promise<number> {
    const jobId = await client.startImport(path);
    set((state) => ({
      importJobs: {
        ...state.importJobs,
        [jobId]: {
          job_id: jobId,
          stage: "ReadingMetadata",
          progress: 0,
          file_hash: "",
          meta_ready: false,
          error: null,
        },
      },
    }));
    return jobId;
  },

  trackImport(jobId: number): void {
    set((state) => {
      if (state.importJobs[jobId]) return state;
      return {
        importJobs: {
          ...state.importJobs,
          [jobId]: {
            job_id: jobId,
            stage: "ReadingMetadata",
            progress: 0,
            file_hash: "",
            meta_ready: false,
            error: null,
          },
        },
      };
    });
  },

  async prioritizeImport(jobId: number, channels: string[]): Promise<void> {
    await client.prioritizeImport(jobId, channels);
  },

  updateImportStatus(status: ImportStatus) {
    set((state) => ({
      importJobs: {
        ...state.importJobs,
        [status.job_id]: status,
      },
    }));
    const shouldOpen =
      !get().cloudSyncBusy &&
      status.meta_ready &&
      status.file_hash &&
      get().dataset?.file_hash !== status.file_hash &&
      get().openingFileHash !== status.file_hash;
    if (shouldOpen) {
      set({ openingFileHash: status.file_hash });
      void get()
        .openDataset(status.file_hash)
        .catch(() => set({ openingFileHash: null }));
    }
  },

  setRemoteToken(token: string) {
    set({ remoteToken: token });
    try {
      localStorage.setItem("scut.remote-token", token.trim());
    } catch {
      // Embedded webviews may disable local storage; the current session still works.
    }
  },

  setRemoteAutosync(enabled: boolean) {
    set({ remoteAutosync: enabled });
    try {
      localStorage.setItem("scut.remote-autosync", String(enabled));
    } catch {
      // Embedded webviews may disable local storage; the current session still works.
    }
  },

  async checkCloudUpdates(options?: { auto?: boolean }): Promise<void> {
    const auto = options?.auto ?? false;
    const baseUrl = remoteBaseUrl();
    const token = get().remoteToken.trim();
    if (!baseUrl || !token) {
      if (!auto) {
        set((s) => ({ cloudSync: { ...s.cloudSync, phase: "error", message: "请先填写服务器地址与访问密钥。" } }));
      }
      return;
    }
    if (get().cloudSyncBusy) return;
    set((s) => ({ cloudSync: { ...s.cloudSync, phase: "checking", message: auto ? s.cloudSync.message : "" } }));
    try {
      const [cloud, local] = await Promise.all([listRemoteDatasets(baseUrl, token), client.listRecords("")]);
      const fresh = diffRemoteDatasets(cloud, local.map((record) => record.file_hash));
      const now = Date.now();
      if (fresh.length === 0) {
        set((s) => ({
          cloudSync: {
            ...s.cloudSync,
            phase: "idle",
            newFiles: [],
            done: 0,
            total: 0,
            currentName: "",
            lastSyncAt: now,
            message: auto ? "" : "已是最新数据。",
          },
        }));
        return;
      }
      set((s) => ({
        cloudSync: {
          ...s.cloudSync,
          phase: auto ? "downloading" : "confirm",
          newFiles: fresh,
          done: 0,
          total: fresh.length,
          currentName: "",
          lastSyncAt: now,
        },
      }));
      if (auto) await get().runCloudSync();
    } catch (error) {
      // 启动静默检查失败不打扰；手动检查给出原因
      set((s) => ({
        cloudSync: {
          ...s.cloudSync,
          phase: s.cloudSync.phase === "checking" ? "idle" : s.cloudSync.phase,
          message: auto ? s.cloudSync.message : `同步检查失败：${errorMessage(error)}`,
        },
      }));
    }
  },

  async runCloudSync(): Promise<void> {
    const files = get().cloudSync.newFiles;
    if (files.length === 0 || get().cloudSyncBusy) return;
    const baseUrl = remoteBaseUrl();
    const token = get().remoteToken.trim();
    if (!baseUrl || !token) {
      set((s) => ({ cloudSync: { ...s.cloudSync, phase: "error", message: "请先填写服务器地址与访问密钥。" } }));
      return;
    }

    set({ cloudSyncBusy: true });
    const failures: string[] = [];
    let imported = 0;
    let duplicated = 0;
    try {
      set((s) => ({ cloudSync: { ...s.cloudSync, phase: "downloading", total: files.length, done: 0, message: "" } }));
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        set((s) => ({ cloudSync: { ...s.cloudSync, done: index, currentName: file.file_name } }));
        let path: string;
        try {
          const ext = (file.file_type || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "bin";
          path = await client.cloudDownloadFile(baseUrl, token, file.file_hash, ext, file.file_name);
        } catch (error) {
          failures.push(`下载 ${file.file_name} 失败：${errorMessage(error)}`);
          continue;
        }
        set((s) => ({ cloudSync: { ...s.cloudSync, phase: "importing", done: index, currentName: file.file_name } }));
        try {
          const outcomes = await client.importFiles([path]);
          const outcome = outcomes[0];
          if (outcome?.status === "queued" && outcome.job_id !== null) {
            get().trackImport(outcome.job_id);
            const status = await waitForImportJob(outcome.job_id);
            if (status.stage === "Ready") imported++;
            else if (status.stage === "Failed") {
              failures.push(`导入 ${outcome.file_name} 失败：${status.error ?? "未知错误"}`);
            } else {
              duplicated++;
            }
          } else if (outcome?.status === "duplicate") {
            duplicated++;
          } else if (outcome?.status === "failed") {
            failures.push(`导入 ${outcome.file_name} 失败：${outcome.message ?? "未知错误"}`);
          }
        } catch (error) {
          failures.push(`导入失败：${errorMessage(error)}`);
        }
        // 导入管线已把源文件归档进数据目录，中转副本用完即删（幂等）
        await client.cloudRemoveTransit(path).catch(() => undefined);
        set((s) => ({ cloudSync: { ...s.cloudSync, done: index + 1, currentName: "" } }));
      }
    } finally {
      set({ cloudSyncBusy: false });
    }

    const parts: string[] = [];
    if (imported > 0) parts.push(`新增 ${imported} 条记录`);
    if (duplicated > 0) parts.push(`${duplicated} 条本地已存在`);
    if (failures.length > 0) parts.push(`${failures.length} 个失败`);
    set((s) => ({
      cloudSync: {
        ...s.cloudSync,
        phase: "done",
        message: `同步完成：${parts.length > 0 ? parts.join("，") : "没有需要同步的记录"}`,
        lastSyncAt: Date.now(),
      },
    }));
  },

  dismissCloudSync() {
    // 保留 newFiles：提示条上仍可一键重新发起下载
    set((s) => ({ cloudSync: { ...s.cloudSync, phase: "idle", message: "" } }));
  },

  ignoreCloudSync() {
    set((s) => ({
      cloudSync: {
        phase: "idle",
        newFiles: [],
        done: 0,
        total: 0,
        currentName: "",
        message: "",
        lastSyncAt: s.cloudSync.lastSyncAt,
      },
    }));
  },
}));
