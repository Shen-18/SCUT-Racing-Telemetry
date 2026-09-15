import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportProgressBar, STAGE_LABELS } from "./ImportProgressBar";
import type { ImportStage, ImportStatus } from "../api/types";

describe("ImportProgressBar and stage text mapping", () => {
  const allStages: ImportStage[] = [
    "ReadingMetadata",
    "ReadingChannels",
    "BuildingRawCache",
    "BuildingPyramid",
    "Ready",
    "Failed",
    "Cancelled",
  ];

  it("maps all 7 ImportStages to descriptive Chinese text labels", () => {
    for (const stage of allStages) {
      expect(STAGE_LABELS[stage]).toBeDefined();
      expect(typeof STAGE_LABELS[stage]).toBe("string");
      expect(STAGE_LABELS[stage].length).toBeGreaterThan(0);
    }
    expect(STAGE_LABELS.ReadingMetadata).toContain("元数据");
    expect(STAGE_LABELS.ReadingChannels).toContain("通道");
    expect(STAGE_LABELS.BuildingRawCache).toContain("缓存");
    expect(STAGE_LABELS.BuildingPyramid).toContain("金字塔");
    expect(STAGE_LABELS.Ready).toContain("就绪");
  });

  it("renders stage label and formatted percentage", () => {
    const status: ImportStatus = {
      job_id: 1,
      stage: "BuildingPyramid",
      progress: 0.72,
      file_hash: "hash_abc",
      meta_ready: true,
      error: null,
    };
    const html = renderToStaticMarkup(<ImportProgressBar status={status} />);
    expect(html).toContain(STAGE_LABELS.BuildingPyramid);
    expect(html).toContain("72%");
  });

  it("renders tokenized styling with zero hardcoded colors", () => {
    const status: ImportStatus = {
      job_id: 1,
      stage: "BuildingRawCache",
      progress: 0.35,
      file_hash: "hash_abc",
      meta_ready: true,
      error: null,
    };
    const html = renderToStaticMarkup(<ImportProgressBar status={status} />);
    // Check that CSS variable tokens are used for colors
    expect(html).toContain("var(--");
    // Verify no hardcoded hex colors like #123456 or #abc
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Verify no hardcoded rgb/rgba
    expect(html).not.toMatch(/rgba?\(/);
  });

  it("displays error message if status has error", () => {
    const status: ImportStatus = {
      job_id: 2,
      stage: "Failed",
      progress: 0.1,
      file_hash: "hash_fail",
      meta_ready: false,
      error: "Corrupted XRK header",
    };
    const html = renderToStaticMarkup(<ImportProgressBar status={status} />);
    expect(html).toContain(STAGE_LABELS.Failed);
    expect(html).toContain("Corrupted XRK header");
  });
});
