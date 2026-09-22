import { create } from "zustand";
import type { DatasetMeta, ImportStatus, WindowFrame, ImportStage } from "../api/client";
import * as client from "../api/client";
import { getDatasetDuration } from "../api/dataset";
import { clampToSampleRange, clampWindowToSampleRange, type SampleRange } from "../utils/sampleRange";

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
  view: "library" | "analysis";
  playing: boolean;

  openDataset(fileHash: string): Promise<void>;
  setView(view: "library" | "analysis"): void;
  setPlaying(playing: boolean): void;
  setWindow(w: { start: number; end: number }): void;
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
  leftWidth: LEFT_WIDTH_RANGE.default,
  rightWidth: RIGHT_WIDTH_RANGE.default,
  view: "library",

  bumpGeneration() {
    set((state) => ({ generation: state.generation + 1 }));
  },

  setWindow(w: { start: number; end: number }) {
    set((state) => ({
      window: clampWindowToSampleRange(w, state.activeRange),
      generation: state.generation + 1,
    }));
  },

  setView(view: "library" | "analysis") {
    // 切视图即暂停播放，避免离开分析页后游标继续跑
    set({ view, playing: false });
  },

  setPlaying(playing: boolean) {
    set({ playing });
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
    get().setActiveRange(null);
    if (selected.length === 0) return;
    void client.sampleOverlap(dataset.id, selected).then((range) => {
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
    const initialChecked = defaultSpeedKey
      ? [defaultSpeedKey]
      : channelKeys.length > 0
        ? [channelKeys[0]]
        : [];
    const duration = getDatasetDuration(meta);

    set((state) => ({
      dataset: meta,
      checkedChannels: initialChecked,
      channelOrder: channelKeys,
      window: { start: 0, end: duration },
      activeRange: null,
      generation: state.generation + 1,
      currentFrame: null,
      openingFileHash: null,
      view: "analysis",
    }));
    try {
      const range = await client.sampleOverlap(meta.id, initialChecked);
      if (range && useAppStore.getState().dataset?.id === meta.id) {
        useAppStore.getState().setActiveRange(range);
      }
    } catch {
      // Metadata duration remains a fallback for older caches.
    }
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
}));
