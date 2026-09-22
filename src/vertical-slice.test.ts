import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./state/appStore";
import * as client from "./api/client";
import { wireFrame } from "./api/frame.test";

describe("Frontend vertical slice acceptance pipeline", () => {
  const agxMeta: client.DatasetMeta = {
    id: 1,
    file_hash: "sha256_agx_sample",
    file_size: 626_948,
    meta: {
      file_path: "D:\\Data\\test_session.agx",
      file_type: "agx",
      session: "Qualifying",
      vehicle: "SCUT-01",
      racer: "Driver A",
      championship: "FSAE",
      comment: "",
      date: "2026-09-15",
      start_time: "09:30:00",
      sample_rate_hz: 50,
      duration: 65.5,
    },
    channels: [
      { key: "GPS Speed", name: "GPS Speed", unit: "km/h", source: "DerivedGps", dtype: "Numeric", sample_rate_hz: 50, ready: true },
      { key: "RPM", name: "RPM", unit: "rpm", source: "AiM", dtype: "Numeric", sample_rate_hz: 50, ready: false },
      { key: "Steering", name: "Steering", unit: "deg", source: "AiM", dtype: "Numeric", sample_rate_hz: 50, ready: false },
    ],
  };

  beforeEach(() => {
    useAppStore.setState({
      dataset: null,
      checkedChannels: [],
      channelOrder: [],
      window: { start: 0, end: 1 },
      cursorT: 0,
      theme: "dark",
      layoutPreset: "default",
      generation: 0,
      importJobs: {},
      currentFrame: null,
      openingFileHash: null,
    });
    vi.restoreAllMocks();
  });

  it("completes AGX import -> meta_ready channels -> Ready Speed plot -> zoom bump & discard expired frames", async () => {
    // 1. Mock client API calls
    const startImportSpy = vi.spyOn(client, "startImport").mockResolvedValue(101);
    const openDatasetSpy = vi.spyOn(client, "openDataset").mockResolvedValue(agxMeta);
    const prioritizeSpy = vi.spyOn(client, "prioritizeImport").mockResolvedValue();
    const windowSeriesSpy = vi.spyOn(client, "windowSeries").mockImplementation(
      async (_id, channel, start, end, _pixels, gen) => {
        return client.decodeFrame(wireFrame(gen, { channel, win_start: start, win_end: end }));
      }
    );

    // 2. Start Import
    const jobId = await useAppStore.getState().startImport("D:\\Data\\test_session.agx");
    expect(jobId).toBe(101);
    expect(startImportSpy).toHaveBeenCalledWith("D:\\Data\\test_session.agx");

    // 3. Status update: ReadingChannels with meta_ready = true
    useAppStore.getState().updateImportStatus({
      job_id: 101,
      stage: "ReadingChannels",
      progress: 0.3,
      file_hash: "sha256_agx_sample",
      meta_ready: true,
      error: null,
    });

    // Wait for openDataset to resolve
    await new Promise((r) => setTimeout(r, 10));

    // Channels must be visible immediately after meta_ready
    const storeAfterMeta = useAppStore.getState();
    expect(openDatasetSpy).toHaveBeenCalledWith("sha256_agx_sample");
    expect(storeAfterMeta.dataset).toEqual(agxMeta);
    expect(storeAfterMeta.dataset?.channels.length).toBe(3);
    expect(storeAfterMeta.window).toEqual({ start: 0, end: 65.5 });
    // Real AGX default speed channel is selected, not hardcoded "Speed"
    expect(storeAfterMeta.checkedChannels).toContain("GPS Speed");
    expect(storeAfterMeta.checkedChannels).not.toContain("Speed");

    // 4. Click to prioritize during active import
    await useAppStore.getState().toggleChannelAndPrioritize("RPM");
    expect(prioritizeSpy).toHaveBeenCalledWith(101, ["RPM"]);
    expect(useAppStore.getState().checkedChannels).toContain("RPM");

    // 5. Status update: Ready -> loads initial Speed WindowSeries curve
    useAppStore.getState().updateImportStatus({
      job_id: 101,
      stage: "Ready",
      progress: 1.0,
      file_hash: "sha256_agx_sample",
      meta_ready: true,
      error: null,
    });

    const activeSpeedChannel = client.selectDefaultSpeedChannel(agxMeta.channels)!;
    expect(activeSpeedChannel).toBe("GPS Speed");

    const initialGen = useAppStore.getState().generation;
    const initialFrame = await client.windowSeries(
      agxMeta.id,
      activeSpeedChannel,
      0,
      65.5,
      512,
      initialGen
    );
    const appliedInitial = useAppStore.getState().applyFrame(initialFrame);
    expect(appliedInitial).toBe(true);
    expect(useAppStore.getState().currentFrame?.header.channel).toBe("GPS Speed");
    expect(useAppStore.getState().currentFrame?.header.generation).toBe(initialGen);

    // 6. User zooms or pans viewport -> bumps generation to initialGen + 1
    useAppStore.getState().setWindow({ start: 10.0, end: 25.0 });
    const bumpedGen = useAppStore.getState().generation;
    expect(bumpedGen).toBe(initialGen + 1);

    // 7. A late-arriving frame with the old generation arrives -> MUST BE DISCARDED
    const staleFrame = client.decodeFrame(wireFrame(initialGen, { channel: "StaleSpeed" }));
    const appliedStale = useAppStore.getState().applyFrame(staleFrame);
    expect(appliedStale).toBe(false);
    // currentFrame must not be set to the stale frame
    expect(useAppStore.getState().currentFrame?.header.channel).not.toBe("StaleSpeed");

    // 8. The fresh frame with bumpedGen arrives -> ACCEPTED
    const freshFrame = await client.windowSeries(
      agxMeta.id,
      activeSpeedChannel,
      10.0,
      25.0,
      512,
      bumpedGen
    );
    const appliedFresh = useAppStore.getState().applyFrame(freshFrame);
    expect(appliedFresh).toBe(true);
    expect(useAppStore.getState().currentFrame?.header.generation).toBe(bumpedGen);
    expect(useAppStore.getState().currentFrame?.header.channel).toBe("GPS Speed");
    expect(windowSeriesSpy).toHaveBeenCalled();
  });
});
