import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./appStore";
import * as client from "../api/client";
import { wireFrame } from "../api/frame.test";

const sessionMeta = (duration: number, filePath = "D:\\Data\\test.xrk"): client.DatasetMeta["meta"] => ({
  file_path: filePath,
  file_type: "xrk",
  session: "Test",
  vehicle: "SCUT",
  racer: "Driver",
  championship: "FSAE",
  comment: "",
  date: "2026-09-15",
  start_time: "09:30:00",
  sample_rate_hz: 50,
  duration,
});

describe("appStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
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
    });
  });

  it("initializes with expected default state", () => {
    const state = useAppStore.getState();
    expect(state.dataset).toBeNull();
    expect(state.checkedChannels).toEqual([]);
    expect(state.channelOrder).toEqual([]);
    expect(state.window).toEqual({ start: 0, end: 1 });
    expect(state.activeRange).toBeNull();
    expect(state.cursorT).toBe(0);
    expect(state.theme).toBe("dark");
    expect(state.layoutPreset).toBe("default");
    expect(state.generation).toBe(0);
    expect(state.importJobs).toEqual({});
  });

  it("bumpGeneration increments generation number", () => {
    expect(useAppStore.getState().generation).toBe(0);
    useAppStore.getState().bumpGeneration();
    expect(useAppStore.getState().generation).toBe(1);
    useAppStore.getState().bumpGeneration();
    expect(useAppStore.getState().generation).toBe(2);
  });

  it("setWindow updates window and automatically bumps generation", () => {
    useAppStore.getState().setWindow({ start: 10, end: 25 });
    const state = useAppStore.getState();
    expect(state.window).toEqual({ start: 10, end: 25 });
    expect(state.generation).toBe(1);
  });

  it("clamps viewport and cursor to the real sample range", () => {
    useAppStore.getState().setActiveRange({ start: 7.79, end: 47.89 });
    useAppStore.getState().setWindow({ start: 0, end: 999 });
    useAppStore.getState().setCursor(999);
    const state = useAppStore.getState();
    expect(state.window).toEqual({ start: 7.79, end: 47.89 });
    expect(state.cursorT).toBe(47.89);
  });

  it("discards expired frames when generation does not match current state", () => {
    // Current generation is 0. Bump to 1.
    useAppStore.getState().bumpGeneration();
    expect(useAppStore.getState().generation).toBe(1);

    // Frame with stale generation 0
    const staleFrame = client.decodeFrame(wireFrame(0));
    const appliedStale = useAppStore.getState().applyFrame(staleFrame);
    expect(appliedStale).toBe(false);
    expect(useAppStore.getState().currentFrame).toBeNull();

    // Frame with matching generation 1
    const freshFrame = client.decodeFrame(wireFrame(1));
    const appliedFresh = useAppStore.getState().applyFrame(freshFrame);
    expect(appliedFresh).toBe(true);
    expect(useAppStore.getState().currentFrame?.header.generation).toBe(1);

    // After viewport changes (bump generation to 2), the old frame is not matched
    useAppStore.getState().bumpGeneration();
    expect(useAppStore.getState().generation).toBe(2);
    const anotherStaleFrame = client.decodeFrame(wireFrame(1));
    const appliedAnotherStale = useAppStore.getState().applyFrame(anotherStaleFrame);
    expect(appliedAnotherStale).toBe(false);
  });

  it("toggleChannel and reorderChannels modify channel state", () => {
    useAppStore.getState().toggleChannel("Speed");
    expect(useAppStore.getState().checkedChannels).toEqual(["Speed"]);
    useAppStore.getState().toggleChannel("Speed");
    expect(useAppStore.getState().checkedChannels).toEqual([]);

    useAppStore.getState().reorderChannels(["Speed", "RPM", "Steering"]);
    expect(useAppStore.getState().channelOrder).toEqual(["Speed", "RPM", "Steering"]);
  });

  it("uses the common real range of the currently selected channels", async () => {
    useAppStore.setState({
      dataset: {
        id: 7,
        file_hash: "range-hash",
        meta: sessionMeta(641.9),
        channels: [
          { key: "Brake", name: "Brake", unit: "#", dtype: "Numeric", source: "Standard", sample_rate_hz: 100 },
        ],
      },
      window: { start: 0, end: 641.9 },
    });
    vi.spyOn(client, "sampleOverlap").mockResolvedValueOnce({ start: 4.672, end: 641.397 });

    useAppStore.getState().toggleChannel("Brake");

    await vi.waitFor(() => {
      expect(useAppStore.getState().activeRange).toEqual({ start: 4.672, end: 641.397 });
    });
    expect(useAppStore.getState().window).toEqual({ start: 4.672, end: 641.397 });
    expect(client.sampleOverlap).toHaveBeenCalledWith(7, ["Brake"]);
  });

  it("setTheme and setCursor update respective properties", () => {
    useAppStore.getState().setCursor(4.5);
    expect(useAppStore.getState().cursorT).toBe(4.5);

    useAppStore.getState().setTheme("light");
    expect(useAppStore.getState().theme).toBe("light");
  });

  it("openDataset loads dataset and initializes window and default channels", async () => {
    const mockMeta: client.DatasetMeta = {
      id: 1,
      file_hash: "hash123",
      meta: sessionMeta(35.5),
      channels: [
        { key: "Speed", name: "Speed", unit: "km/h", dtype: "Numeric", source: "AiM", sample_rate_hz: 50, ready: true },
        { key: "RPM", name: "RPM", unit: "rpm", dtype: "Numeric", source: "AiM", sample_rate_hz: 50, ready: true },
      ],
    };
    vi.spyOn(client, "openDataset").mockResolvedValueOnce(mockMeta);

    await useAppStore.getState().openDataset("hash123");
    const state = useAppStore.getState();
    expect(state.dataset).toEqual(mockMeta);
    expect(state.window).toEqual({ start: 0, end: 35.5 });
    expect(state.checkedChannels).toContain("Speed");
    expect(state.generation).toBeGreaterThan(0);
  });

  it("uses the duration from the real nested DatasetMeta response", async () => {
    const realBackendMeta = {
      id: 17,
      file_hash: "real_agx_hash",
      meta: {
        file_path: "D:\\Desktop\\SCUTRacingTelemetry\\Data\\AGX.xrk",
        file_type: "xrk",
        session: "Practice",
        vehicle: "SCUT",
        racer: "Driver",
        championship: "FSAE",
        comment: "",
        date: "2026-09-15",
        start_time: "09:30:00",
        sample_rate_hz: 50,
        duration: 127.375,
      },
      channels: [
        {
          key: "GPS Speed (AiM Interpolated)",
          name: "GPS Speed (AiM Interpolated)",
          unit: "km/h",
          dtype: "Numeric",
          source: "Gps",
          sample_rate_hz: 50,
        },
      ],
    } as unknown as client.DatasetMeta;
    vi.spyOn(client, "openDataset").mockResolvedValueOnce(realBackendMeta);

    await useAppStore.getState().openDataset("real_agx_hash");

    expect(useAppStore.getState().window).toEqual({ start: 0, end: 127.375 });
  });

  it("openDataset prioritizes official 'GPS Speed (AiM Interpolated)' for real AGX dataset", async () => {
    const agxMeta: client.DatasetMeta = {
      id: 2,
      file_hash: "hash_agx",
      meta: sessionMeta(50, "D:\\Data\\AGX.xrk"),
      channels: [
        { key: "Battery_V", name: "Battery_V", unit: "V", dtype: "Numeric", source: "Standard", sample_rate_hz: 50 },
        { key: "GPS Speed", name: "GPS Speed", unit: "km/h", dtype: "Numeric", source: "DerivedGps", sample_rate_hz: 50 },
        { key: "GPS Speed (AiM Interpolated)", name: "GPS Speed (AiM Interpolated)", unit: "km/h", dtype: "Numeric", source: "Gps", sample_rate_hz: 50 },
        { key: "RPM", name: "RPM", unit: "rpm", dtype: "Numeric", source: "Standard", sample_rate_hz: 50 },
      ],
    };
    vi.spyOn(client, "openDataset").mockResolvedValueOnce(agxMeta);

    await useAppStore.getState().openDataset("hash_agx");
    const state = useAppStore.getState();
    expect(state.checkedChannels).toEqual(["GPS Speed (AiM Interpolated)"]);
  });

  it("openDataset selects raw 'GPS Speed' when official interpolated GPS channel is absent", async () => {
    const rawGpsMeta: client.DatasetMeta = {
      id: 3,
      file_hash: "hash_raw_gps",
      meta: sessionMeta(40, "D:\\Data\\raw.xrk"),
      channels: [
        { key: "Battery_V", name: "Battery_V", unit: "V", dtype: "Numeric", source: "Standard", sample_rate_hz: 50 },
        { key: "GPS Speed", name: "GPS Speed", unit: "km/h", dtype: "Numeric", source: "DerivedGps", sample_rate_hz: 50 },
      ],
    };
    vi.spyOn(client, "openDataset").mockResolvedValueOnce(rawGpsMeta);

    await useAppStore.getState().openDataset("hash_raw_gps");
    const state = useAppStore.getState();
    expect(state.checkedChannels).toEqual(["GPS Speed"]);
  });

  it("openDataset falls back to first channel when no speed channel is present", async () => {
    const noSpeedMeta: client.DatasetMeta = {
      id: 4,
      file_hash: "hash_no_speed",
      meta: sessionMeta(40, "D:\\Data\\nospeed.xrk"),
      channels: [
        { key: "Engine_RPM", name: "Engine_RPM", unit: "rpm", dtype: "Numeric", source: "Standard", sample_rate_hz: 50 },
        { key: "Water_Temp", name: "Water_Temp", unit: "C", dtype: "Numeric", source: "Standard", sample_rate_hz: 50 },
      ],
    };
    vi.spyOn(client, "openDataset").mockResolvedValueOnce(noSpeedMeta);

    await useAppStore.getState().openDataset("hash_no_speed");
    const state = useAppStore.getState();
    expect(state.checkedChannels).toEqual(["Engine_RPM"]);
  });

  it("startImport and prioritizeImport dispatch to client api", async () => {
    vi.spyOn(client, "startImport").mockResolvedValueOnce(99);
    const jobId = await useAppStore.getState().startImport("D:\\test.xrk");
    expect(jobId).toBe(99);
    expect(useAppStore.getState().importJobs[99]).toBeDefined();

    const prioritizeSpy = vi.spyOn(client, "prioritizeImport").mockResolvedValueOnce();
    await useAppStore.getState().prioritizeImport(99, ["Speed"]);
    expect(prioritizeSpy).toHaveBeenCalledWith(99, ["Speed"]);
  });

  it("opens a newly imported dataset even when another dataset is already active", async () => {
    useAppStore.setState({
      dataset: {
        id: 1,
        file_hash: "old_hash",
        meta: sessionMeta(10, "D:\\Data\\old.xrk"),
        channels: [],
      },
    });
    const nextMeta: client.DatasetMeta = {
      id: 2,
      file_hash: "new_hash",
      meta: sessionMeta(20, "D:\\Data\\new.xrk"),
      channels: [],
    };
    const openSpy = vi.spyOn(client, "openDataset").mockResolvedValueOnce(nextMeta);

    useAppStore.getState().updateImportStatus({
      job_id: 22,
      stage: "ReadingChannels",
      progress: 0.2,
      file_hash: "new_hash",
      meta_ready: true,
      error: null,
    });
    await vi.waitFor(() => expect(useAppStore.getState().dataset?.file_hash).toBe("new_hash"));

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().window).toEqual({ start: 0, end: 20 });
  });
});
