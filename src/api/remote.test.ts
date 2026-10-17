import { afterEach, describe, expect, it, vi } from "vitest";
import { diffRemoteDatasets, listRemoteDatasets, type RemoteDatasetFile } from "./remote";

function makeCloudFile(overrides: Partial<RemoteDatasetFile> = {}): RemoteDatasetFile {
  return {
    file_hash: "a".repeat(64),
    file_name: "session.xrk",
    file_type: "xrk",
    file_size: 1024,
    record_date: "2026-10-05",
    racer: "AGX",
    vehicle: "A04_AF26",
    session: "a_4538",
    ...overrides,
  };
}

describe("diffRemoteDatasets", () => {
  it("returns only cloud files whose hash is missing locally", () => {
    const cloud = [
      makeCloudFile(),
      makeCloudFile({ file_hash: "b".repeat(64), file_name: "b.xrk" }),
      makeCloudFile({ file_hash: "c".repeat(64), file_name: "c.xrz" }),
    ];
    const fresh = diffRemoteDatasets(cloud, new Set(["a".repeat(64)]));
    expect(fresh.map((f) => f.file_name)).toEqual(["b.xrk", "c.xrz"]);
  });

  it("accepts a plain hash array and dedupes repeated cloud hashes", () => {
    const cloud = [makeCloudFile(), makeCloudFile({ file_name: "dup.xrk" })];
    expect(diffRemoteDatasets(cloud, ["b".repeat(64)])).toHaveLength(1);
  });

  it("drops entries without a sha256-shaped hash", () => {
    const cloud = [makeCloudFile({ file_hash: "short" }), makeCloudFile({ file_hash: "" })];
    expect(diffRemoteDatasets(cloud, [])).toHaveLength(0);
  });
});

describe("listRemoteDatasets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and unwraps the datasets array", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ datasets: [makeCloudFile()] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const files = await listRemoteDatasets("http://8.134.196.199/", "token-1");

    expect(files).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://8.134.196.199/api/v1/datasets");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-1");
  });

  it("maps 401 to a revocation message instead of a bare HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(listRemoteDatasets("http://8.134.196.199", "bad")).rejects.toThrow(/密钥无效或已被吊销/);
  });

  it("refuses to run without a configured token", async () => {
    await expect(listRemoteDatasets("http://8.134.196.199", "  ")).rejects.toThrow(/未填写访问密钥/);
  });
});
