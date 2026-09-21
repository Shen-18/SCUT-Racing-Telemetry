import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import type { ImportStage } from "../api/types";
import { isNonTerminalImportStage } from "./ChannelTree";

describe("ChannelTree priority dispatch logic", () => {
  beforeEach(() => {
    useAppStore.setState({
      dataset: {
        id: 1,
        file_hash: "hash123",
        file_size: 123456,
        meta: {
          file_path: "D:\\Data\\test.xrk", file_type: "xrk", session: "Test",
          vehicle: "SCUT", racer: "Driver", championship: "FSAE", comment: "",
          date: "2026-09-15", start_time: "09:30:00", sample_rate_hz: 50, duration: 10,
        },
        channels: [
          { key: "Speed", name: "Speed", unit: "km/h", source: "AiM", dtype: "Numeric", sample_rate_hz: 50 },
          { key: "RPM", name: "RPM", unit: "rpm", source: "AiM", dtype: "Numeric", sample_rate_hz: 50 },
        ],
      },
      checkedChannels: [],
      importJobs: {},
      openingFileHash: null,
    });
    vi.restoreAllMocks();
  });

  it("identifies non-terminal vs terminal import stages correctly", () => {
    const nonTerminal: ImportStage[] = ["ReadingMetadata", "ReadingChannels", "BuildingRawCache", "BuildingPyramid"];
    for (const stage of nonTerminal) {
      expect(isNonTerminalImportStage(stage)).toBe(true);
    }
    const terminal: ImportStage[] = ["Ready", "Failed", "Cancelled"];
    for (const stage of terminal) {
      expect(isNonTerminalImportStage(stage)).toBe(false);
    }
  });

  it("auto-calls prioritizeImport when toggling a channel during non-terminal import", async () => {
    const prioritizeSpy = vi.spyOn(client, "prioritizeImport").mockResolvedValue();

    useAppStore.setState({
      importJobs: {
        42: {
          job_id: 42,
          stage: "BuildingPyramid",
          progress: 0.6,
          file_hash: "hash123",
          meta_ready: true,
          error: null,
        },
      },
    });

    // Checking channel "RPM" should trigger prioritizeImport
    await useAppStore.getState().toggleChannelAndPrioritize("RPM");
    expect(useAppStore.getState().checkedChannels).toContain("RPM");
    expect(prioritizeSpy).toHaveBeenCalledWith(42, ["RPM"]);
  });

  it("does not call prioritizeImport when import is already in terminal stage (Ready)", async () => {
    const prioritizeSpy = vi.spyOn(client, "prioritizeImport").mockResolvedValue();

    useAppStore.setState({
      importJobs: {
        42: {
          job_id: 42,
          stage: "Ready",
          progress: 1.0,
          file_hash: "hash123",
          meta_ready: true,
          error: null,
        },
      },
    });

    await useAppStore.getState().toggleChannelAndPrioritize("Speed");
    expect(useAppStore.getState().checkedChannels).toContain("Speed");
    expect(prioritizeSpy).not.toHaveBeenCalled();
  });
});
