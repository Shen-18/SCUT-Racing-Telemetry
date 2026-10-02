import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TimeAxisStrip,
  computeTimeAxisTicks,
  formatTimeTick,
  niceTimeStep,
} from "./TimeAxisStrip";
import { useAppStore } from "../state/appStore";

describe("TimeAxisStrip tick computation", () => {
  it("rounds raw steps up to 1-2-5 × 10^n", () => {
    expect(niceTimeStep(0.16)).toBe(0.2);
    expect(niceTimeStep(1.28)).toBe(2);
    expect(niceTimeStep(7.2)).toBe(10);
    expect(niceTimeStep(1)).toBe(1);
    expect(niceTimeStep(0)).toBe(1);
    expect(niceTimeStep(Number.NaN)).toBe(1);
  });

  it("formats ticks without trailing zeros and keeps integer seconds intact", () => {
    expect(formatTimeTick(0.6, 1)).toBe("0.6");
    expect(formatTimeTick(2, 0)).toBe("2");
    expect(formatTimeTick(10, 1)).toBe("10");
  });

  it("generates aligned ticks across the window", () => {
    const ticks = computeTimeAxisTicks(0, 10, 500);
    // rawStep = 10*64/500 = 1.28 -> step 2s
    expect(ticks.map((t) => t.t)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks.map((t) => t.label)).toEqual(["0s", "2s", "4s", "6s", "8s", "10s"]);
  });

  it("uses sub-second decimals for short windows", () => {
    const ticks = computeTimeAxisTicks(1.2, 2.8, 800);
    // rawStep = 1.6*64/800 = 0.128 -> step 0.2s
    expect(ticks[0].t).toBeCloseTo(1.2, 6);
    expect(ticks[0].label).toBe("1.2s");
    expect(ticks.at(-1)!.t).toBeCloseTo(2.8, 6);
  });

  it("returns no ticks for degenerate windows or zero width", () => {
    expect(computeTimeAxisTicks(5, 5, 500)).toEqual([]);
    expect(computeTimeAxisTicks(6, 5, 500)).toEqual([]);
    expect(computeTimeAxisTicks(0, 10, 0)).toEqual([]);
  });
});

describe("TimeAxisStrip rendering", () => {
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
      activeRange: { start: 0, end: 100 },
      cursorT: 25,
      generation: 1,
    });
  });

  it("renders the strip host aligned to the shared y-axis width", () => {
    const html = renderToStaticMarkup(
      <TimeAxisStrip yAxisWidth={64} window={{ start: 20, end: 50 }} domain={{ start: 0, end: 100 }} cursorT={25} />,
    );
    expect(html).toContain('data-testid="time-axis-strip"');
    // 静态渲染无布局，plotWidth=0 无刻度；宿主可拖拽手势样式可见
    expect(html).toContain("grab");
  });

  it("renders the cursor line only when the cursor is inside the window", () => {
    const inside = renderToStaticMarkup(
      <TimeAxisStrip yAxisWidth={64} window={{ start: 20, end: 50 }} domain={{ start: 0, end: 100 }} cursorT={25} />,
    );
    expect(inside).toContain('data-testid="time-axis-cursor"');

    const outside = renderToStaticMarkup(
      <TimeAxisStrip yAxisWidth={64} window={{ start: 20, end: 50 }} domain={{ start: 0, end: 100 }} cursorT={80} />,
    );
    expect(outside).not.toContain('data-testid="time-axis-cursor"');
  });
});
