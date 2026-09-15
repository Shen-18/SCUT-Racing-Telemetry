import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TimelineBar, calculateTimelinePan, timelinePanThrottleDelay } from "./TimelineBar";
import { useAppStore } from "../state/appStore";

describe("TimelineBar viewport panning and clamping calculation", () => {
  beforeEach(() => {
    useAppStore.setState({
      dataset: {
        id: 1,
        file_hash: "hash_test",
        meta: {
          file_path: "D:\\Data\\test.xrk", file_type: "xrk", session: "Test",
          vehicle: "SCUT", racer: "Driver", championship: "FSAE", comment: "",
          date: "2026-09-15", start_time: "09:30:00", sample_rate_hz: 50, duration: 100,
        },
        channels: [],
      },
      window: { start: 20, end: 50 },
      cursorT: 25,
      generation: 1,
    });
  });

  it("calculates proportional viewport pan correctly", () => {
    // trackWidth = 1000px, duration = 100s -> 1px = 0.1s
    // drag deltaX = +100px (+10s)
    const next = calculateTimelinePan(100, 1000, 100, { start: 20, end: 50 });
    expect(next.start).toBeCloseTo(30);
    expect(next.end).toBeCloseTo(60);
  });

  it("clamps to left boundary (0s) when dragged beyond left edge", () => {
    // drag deltaX = -400px (-40s) -> 20s - 40s = -20s -> clamped to start = 0s, span preserved (30s)
    const next = calculateTimelinePan(-400, 1000, 100, { start: 20, end: 50 });
    expect(next.start).toBe(0);
    expect(next.end).toBe(30);
  });

  it("clamps to right boundary (duration) when dragged beyond right edge", () => {
    // drag deltaX = +700px (+70s) -> start=90, end=120 -> clamped to end = 100s, start = 70s
    const next = calculateTimelinePan(700, 1000, 100, { start: 20, end: 50 });
    expect(next.end).toBe(100);
    expect(next.start).toBe(70);
  });

  it("preserves valid range under short window conditions", () => {
    // 10ms short window in 10s file
    const shortWin = { start: 1.0, end: 1.01 };
    const next = calculateTimelinePan(200, 1000, 10, shortWin); // +2s
    expect(next.start).toBeCloseTo(3.0, 3);
    expect(next.end).toBeCloseTo(3.01, 3);
    expect(next.end).toBeGreaterThan(next.start);
  });

  it("renders slider and track with correct percentages", () => {
    const html = renderToStaticMarkup(
      <TimelineBar window={{ start: 20, end: 50 }} duration={100} />
    );
    expect(html).toContain("data-testid=\"timeline-track\"");
    expect(html).toContain("data-testid=\"timeline-slider\"");
    expect(html).toContain("20.00s ~ 50.00s");
  });

  it("limits pan IPC dispatches to one every 50ms", () => {
    expect(timelinePanThrottleDelay(100, 120)).toBe(30);
    expect(timelinePanThrottleDelay(100, 150)).toBe(0);
    expect(timelinePanThrottleDelay(0, 1_000)).toBe(0);
  });
});
