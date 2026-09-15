import { describe, expect, it, vi } from "vitest";
import {
  SCUT_SYNC_KEY,
  createPlotOptions,
  frameToAlignedData,
  formatAxisValues,
  getPlotTheme,
  requiresPlotRebuild,
  resizePlot,
  scutSync,
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
      mins: new Float32Array([10, 20]),
      maxs: new Float32Array([14, 25]),
    });

    expect(data).toEqual([[0, 1], [10, 20], [14, 25]]);
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
      "1.0 km/h",
      "2.0 km/h",
      "3.0 km/h",
    ]);
  });

  it("resizePlot calls setSize on the uPlot instance", () => {
    const mockPlot = {
      setSize: vi.fn(),
    } as unknown as uPlot;
    resizePlot(mockPlot, 1024, 400);
    expect(mockPlot.setSize).toHaveBeenCalledWith({ width: 1024, height: 400 });
  });
});
