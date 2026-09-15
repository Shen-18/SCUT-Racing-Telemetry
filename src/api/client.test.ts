import { describe, expect, it, vi } from "vitest";
import * as client from "./client";
import { wireFrame } from "./frame.test";

describe("api client and frame decode contract", () => {
  it("exports all frozen Step 5 API functions", () => {
    const requiredFunctions = [
      "startImport",
      "startImportBatch",
      "importStatus",
      "cancelImport",
      "prioritizeImport",
      "openDataset",
      "closeDataset",
      "datasetMeta",
      "windowSeries",
      "cursorValues",
      "getLaps",
      "getStats",
      "listRecords",
      "deleteRecord",
      "exportCsv",
      "getComments",
      "addComment",
      "deleteComment",
      "saveLayout",
      "loadLayout",
      "estimateOffset",
      "purgeCache",
      "cacheRootStatus",
      "decodeFrame",
    ];
    for (const fnName of requiredFunctions) {
      expect(typeof (client as Record<string, unknown>)[fnName]).toBe("function");
    }
  });

  it("decodeFrame decodes SXK1 binary frames and echoes generation", () => {
    const bytes = wireFrame(42, { channel: "Speed", unit: "km/h" }, [10, 20, 30]);
    const frame = client.decodeFrame(bytes);
    expect(frame.header.generation).toBe(42);
    expect(frame.header.channel).toBe("Speed");
    expect(frame.header.unit).toBe("km/h");
    expect(frame.header.buckets).toBe(3);
    expect([...frame.times]).toEqual([0, 1, 2]);
    expect([...frame.mins]).toEqual([10, 20, 30]);
    expect([...frame.maxs]).toEqual([11, 21, 31]);
  });

  it("decodeFrame discards expired frames when expected generation mismatches", () => {
    const bytes = wireFrame(42);
    // matching generation returns frame
    const matched = client.decodeFrame(bytes, 42);
    expect(matched).not.toBeNull();
    expect(matched?.header.generation).toBe(42);

    // outdated generation (e.g. expected gen 43, received frame gen 42) is discarded (returns null)
    const outdated = client.decodeFrame(bytes, 43);
    expect(outdated).toBeNull();
  });

  it("windowSeries decodes binary frame and validates matching generation", async () => {
    const spy = vi.spyOn(client.clientApi, "invoke").mockResolvedValueOnce(wireFrame(15));
    const frame = await client.windowSeries(1, "Speed", 0, 10, 512, 15);
    expect(frame.header.generation).toBe(15);
    expect(spy).toHaveBeenCalledWith("window_series", {
      id: 1,
      channel: "Speed",
      start: 0,
      end: 10,
      pixels: 512,
      generation: 15,
    });
    spy.mockRestore();
  });

  it("windowSeries rejects when returned frame generation mismatches", async () => {
    const spy = vi.spyOn(client.clientApi, "invoke").mockResolvedValueOnce(wireFrame(14));
    await expect(client.windowSeries(1, "Speed", 0, 10, 512, 15)).rejects.toThrow(
      /Generation mismatch/i
    );
    spy.mockRestore();
  });
});
