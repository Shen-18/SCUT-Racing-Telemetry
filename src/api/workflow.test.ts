import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportWorkflow } from "./workflow";
import { decodeFrame } from "./frame";
import { wireFrame } from "./frame.test";

const meta = { id: 2, file_hash: "hash", meta: {
  file_path: "D:\\Data\\test.xrk", file_type: "xrk", session: "Test", vehicle: "SCUT",
  racer: "Driver", championship: "FSAE", comment: "", date: "2026-09-15",
  start_time: "09:30:00", sample_rate_hz: 50, duration: 2,
}, channels: [
  { key: "Speed", name: "Speed", unit: "km/h", source: "AiM", dtype: "Numeric", sample_rate_hz: 50 }] };
function setup(stages = ["ReadingChannels", "BuildingPyramid", "Ready"]) {
  const api = {
    startImport: vi.fn(async () => 1),
    importStatus: vi.fn(async () => ({ job_id: 1, stage: stages.shift() ?? "Ready", progress: 0.5,
      file_hash: "hash", meta_ready: true, error: null })),
    openDataset: vi.fn(async () => meta), closeDataset: vi.fn(async () => {}),
    cancelImport: vi.fn(async () => {}), prioritizeImport: vi.fn(async () => {}),
    windowSeries: vi.fn(async (_id, _channel, _start, _end, _pixels, generation) => decodeFrame(wireFrame(generation))),
  };
  // The fixture models only fields this workflow reads; production uses generated DTOs.
  const flow = new ImportWorkflow(api as unknown as ConstructorParameters<typeof ImportWorkflow>[0]);
  return { api, flow };
}
afterEach(() => { vi.useRealTimers(); });
describe("import workflow", () => {
  it("rejects filename-only input before invoking import", async () => {
    const { api, flow } = setup();
    await flow.start("test.xrk");
    expect(flow.snapshot.error).toContain("absolute path");
    expect(api.startImport).not.toHaveBeenCalled();
  });
  it("opens metadata early, polls every 250ms and stops at Ready", async () => {
    vi.useFakeTimers(); const { flow, api } = setup();
    await flow.start("D:\\Data\\test.xrk");
    expect(flow.snapshot.dataset?.id).toBe(2);
    expect(flow.snapshot.status?.stage).toBe("ReadingChannels");
    await vi.advanceTimersByTimeAsync(249); expect(api.importStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(flow.snapshot.status?.stage).toBe("BuildingPyramid");
    await vi.advanceTimersByTimeAsync(250); expect(flow.snapshot.status?.stage).toBe("Ready");
    await vi.advanceTimersByTimeAsync(1000); expect(api.importStatus).toHaveBeenCalledTimes(3);
    expect(api.openDataset).toHaveBeenCalledTimes(1);
    expect(flow.snapshot.frame?.mins[0]).toBe(12);
    flow.dispose();
  });
  it.each(["Failed", "Cancelled"])("stops polling on %s", async stage => {
    vi.useFakeTimers(); const { flow, api } = setup([stage]);
    await flow.start("/data/test.xrk"); await vi.advanceTimersByTimeAsync(1000);
    expect(flow.snapshot.status?.stage).toBe(stage);
    expect(api.importStatus).toHaveBeenCalledTimes(1);
    expect(api.windowSeries).not.toHaveBeenCalled();
  });
  it("shows channel_building, prioritizes Speed, retries on the next status", async () => {
    vi.useFakeTimers(); const { flow, api } = setup();
    api.windowSeries.mockRejectedValueOnce({ code: "channel_building", message: "building" });
    await flow.start("/data/test.xrk");
    expect(flow.snapshot.plotState).toBe("building");
    expect(flow.snapshot.frame).toBeNull();
    expect(api.prioritizeImport).toHaveBeenCalledWith(1, ["Speed"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(flow.snapshot.plotState).toBe("ready"); flow.dispose();
  });
  it("discards a late frame when a newer window wins", async () => {
    vi.useFakeTimers(); const { flow, api } = setup(["Ready"]);
    await flow.start("/data/test.xrk");
    let finish!: (frame: ReturnType<typeof decodeFrame>) => void;
    api.windowSeries.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = flow.requestWindow(0, 1, 100);
    const generation = api.windowSeries.mock.calls.at(-1)![5];
    await flow.requestWindow(1, 2, 100);
    const current = flow.snapshot.frame;
    finish(decodeFrame(wireFrame(generation))); await old;
    expect(flow.snapshot.frame).toBe(current);
  });
  it("stops and reports structured polling errors", async () => {
    vi.useFakeTimers(); const { flow, api } = setup();
    api.importStatus.mockRejectedValueOnce({ code: "io", message: "Cannot read file" });
    await flow.start("/data/test.xrk"); await vi.advanceTimersByTimeAsync(1000);
    expect(flow.snapshot.error).toContain("Cannot read file");
    expect(api.importStatus).toHaveBeenCalledTimes(1);
  });
});
