import { afterEach, describe, expect, it, vi } from "vitest";
import { syncDatasetIndex, toRemoteDatasetIndex } from "./remote";
import type { RecordSummary } from "./types";

function makeRecord(overrides: Partial<RecordSummary> = {}): RecordSummary {
  return {
    file_hash: "hash-1",
    file_name: "session.xrk",
    file_type: "xrk",
    session: "A",
    vehicle: "A04_AF26",
    racer: "Zicheng Yang",
    record_date: "2026-10-05",
    start_time: "09:30:00",
    duration: 12.5,
    channel_count: 40,
    file_size: 1024,
    source_mtime_unix: 1760000000,
    cache_state: "ready",
    ...overrides,
  };
}

describe("toRemoteDatasetIndex", () => {
  it("maps record fields to the cloud index payload", () => {
    const index = toRemoteDatasetIndex(makeRecord());
    expect(index).toEqual({
      file_hash: "hash-1",
      file_name: "session.xrk",
      file_type: "xrk",
      record_date: "2026-10-05",
      start_time: "09:30:00",
      session: "A",
      vehicle: "A04_AF26",
      racer: "Zicheng Yang",
      championship: "",
      duration: 12.5,
      sample_rate_hz: 0,
      file_size: 1024,
      source_mtime_unix: 1760000000,
    });
  });

  it("drops records whose date cannot be used as a cloud DATE key", () => {
    expect(toRemoteDatasetIndex(makeRecord({ record_date: "未知日期" }))).toBeNull();
    expect(toRemoteDatasetIndex(makeRecord({ record_date: "" }))).toBeNull();
  });
});

describe("syncDatasetIndex", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts one bulk request with only the valid records and reports counts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, count: 2 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDatasetIndex("http://127.0.0.1:8787/", [
      makeRecord(),
      makeRecord({ file_hash: "hash-2", file_name: "b.xrk" }),
      makeRecord({ file_hash: "hash-3", record_date: "UNKNOWN" }),
    ]);

    expect(result).toEqual({ synced: 2, skipped: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8787/api/v1/admin/datasets/bulk");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { datasets: unknown[] };
    expect(body.datasets).toHaveLength(2);
  });

  it("short-circuits without a request when no record has a valid date", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncDatasetIndex("http://127.0.0.1:8787", [makeRecord({ record_date: "" })]);

    expect(result).toEqual({ synced: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with the HTTP status when the cloud rejects the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncDatasetIndex("http://127.0.0.1:8787", [makeRecord()])).rejects.toThrow(/HTTP 500/);
  });
});
