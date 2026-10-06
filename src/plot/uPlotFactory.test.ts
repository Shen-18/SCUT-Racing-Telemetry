import { describe, expect, it, vi } from "vitest";
import {
  SCUT_SYNC_KEY,
  computeYAxisSize,
  createStackedOptions,
  createPlotOptions,
  frameToAlignedData,
  formatAxisValues,
  getPlotTheme,
  requiresPlotRebuild,
  resizePlot,
  scutSync,
  zoomWindowAt,
} from "./uPlotFactory";
import type uPlot from "uplot";

describe("uPlotFactory", () => {
  it("fixes the sync key to 'scut'", () => {
    expect(SCUT_SYNC_KEY).toBe("scut");
    expect(scutSync.key).toBe("scut");
  });

  it("creates plot options with cursor sync key 'scut'", () => {
    const opts = createPlotOptions({
      channel: "Speed",
      unit: "km/h",
      width: 800,
      height: 300,
    });
    expect(opts.width).toBe(800);
    expect(opts.height).toBe(300);
    expect(opts.cursor?.sync?.key).toBe("scut");
    expect(opts.series?.[1]?.label).toBe("Speed");
  });

  it("resolves CSS tokens before passing colours to the canvas renderer", () => {
    const theme = getPlotTheme({
      getPropertyValue: (name: string) =>
        ({
          "--accent": " #44aaff ",
          "--text-muted": " #8899aa ",
          "--border-subtle": " rgba(255, 255, 255, 0.08) ",
          "--border": " #334455 ",
          "--accent-subtle": " rgba(68, 170, 255, 0.15) ",
        })[name] ?? "",
    });
    const opts = createPlotOptions({ channel: "Speed", theme });

    expect(opts.series?.[1]?.stroke).toBe("#44aaff");
    expect(opts.axes?.[0]?.stroke).toBe("#8899aa");
    expect(opts.axes?.[0]?.grid?.stroke).toBe("rgba(255, 255, 255, 0.08)");
    expect(String(opts.series?.[1]?.stroke)).not.toContain("var(");
    expect(opts.axes?.[1]?.size).toBeGreaterThanOrEqual(80);
  });

  it("keeps both min and max envelope values in plot data", () => {
    const data = frameToAlignedData({
      header: {
        channel: "Speed",
        unit: "km/h",
        buckets: 2,
        win_start: 0,
        win_end: 1,
        full_count: 4,
        generation: 1,
      },
      times: new Float64Array([0, 1]),
      mins: new Float64Array([10, 20]),
      maxs: new Float64Array([14, 25]),
    });

    expect(data).toEqual([[0, 1], [10, 20], [14, 25]]);
  });

  it("does not connect across missing telemetry buckets", () => {
    const opts = createStackedOptions({
      channel: "Speed",
      width: 640,
      height: 200,
      xAxisVisible: true,
    });

    expect(opts.series?.[1]?.spanGaps).toBe(false);
  });

  it("keeps units out of stacked plot y-axis tick labels", () => {
    const opts = createStackedOptions({ channel: "Speed", unit: "km/h" });
    const formatter = opts.axes?.[1]?.values;
    expect(typeof formatter).toBe("function");
    const labels = (formatter as ((u: uPlot, values: number[]) => string[]))(null as unknown as uPlot, [0, 25, 50]);
    expect(labels).toEqual(["0", "25", "50"]);
  });

  it("rebuilds plot options when channel identity or unit changes", () => {
    expect(requiresPlotRebuild(null, { channel: "Speed", unit: "km/h" })).toBe(true);
    expect(
      requiresPlotRebuild(
        { channel: "Speed", unit: "km/h" },
        { channel: "RPM", unit: "rpm" }
      )
    ).toBe(true);
    expect(
      requiresPlotRebuild(
        { channel: "Speed", unit: "km/h" },
        { channel: "Speed", unit: "km/h" }
      )
    ).toBe(false);
  });

  it("clears the drag selection after dispatching a zoom window", () => {
    const onWindowChange = vi.fn();
    const setSelect = vi.fn();
    const opts = createPlotOptions({ channel: "Speed", onWindowChange });
    const hook = opts.hooks?.setSelect?.[0];
    hook?.({
      select: { left: 10, width: 40 },
      posToVal: (position: number) => position / 10,
      setSelect,
    } as unknown as uPlot);

    expect(onWindowChange).toHaveBeenCalledWith({ start: 1, end: 5 });
    expect(setSelect).toHaveBeenCalledWith(
      { left: 0, top: 0, width: 0, height: 0 },
      false
    );
  });

  it("keeps enough precision for tightly zoomed axis ticks", () => {
    expect(formatAxisValues([0.101, 0.111, 0.121], "s")).toEqual([
      "0.101s",
      "0.111s",
      "0.121s",
    ]);
    expect(formatAxisValues([1, 2, 3], " km/h")).toEqual([
      "1 km/h",
      "2 km/h",
      "3 km/h",
    ]);
  });

  it("resizePlot calls setSize on the uPlot instance", () => {
    const mockPlot = {
      setSize: vi.fn(),
    } as unknown as uPlot;
    resizePlot(mockPlot, 1024, 400);
    expect(mockPlot.setSize).toHaveBeenCalledWith({ width: 1024, height: 400 });
  });

  it("trims redundant trailing zeroes from axis labels", () => {
    expect(formatAxisValues([-0.5, 0, 0.5], " km/h")).toEqual([
      "-0.5 km/h",
      "0 km/h",
      "0.5 km/h",
    ]);
  });

  it("reserves display room for compact y-axis labels and edge ticks", () => {
    const opts = createStackedOptions({ channel: "Speed", unit: "km/h" });
    const yAxis = opts.axes?.[1];
    expect(typeof yAxis?.size).toBe("function");
    expect(opts.padding?.[0]).toBeGreaterThanOrEqual(12);
    expect(opts.padding?.[2]).toBeGreaterThanOrEqual(12);
  });

  it("sizes the y axis to its widest tick label, compact but untruncated", () => {
    const narrow = computeYAxisSize(["0 km/h"]);
    const wide = computeYAxisSize(["-123.45 km/h"]);
    expect(narrow).toBeGreaterThanOrEqual(24);
    expect(narrow).toBeLessThan(86);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBeLessThanOrEqual(140);
    expect(computeYAxisSize(["", "  "])).toBe(24);
    // uPlot 初始化阶段以 null 调用 size,必须安全返回缺省宽度而不是抛错
    expect(computeYAxisSize(null)).toBe(24);
  });

  it("can render a marker at every sample for a short exact window", () => {
    const opts = createStackedOptions({ channel: "Speed", showPoints: true });
    expect(opts.series?.[1]?.points?.show).toBe(true);
    expect(opts.series?.[1]?.points?.size).toBe(4);
  });

  it("zooms around the cursor anchor in both directions", () => {
    expect(zoomWindowAt({ start: 0, end: 10 }, 5, -1)).toEqual({ start: 1, end: 9 });
    expect(zoomWindowAt({ start: 0, end: 10 }, 5, 1)).toEqual({ start: -1.25, end: 11.25 });
  });
});
