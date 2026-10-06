import { describe, expect, it, vi } from "vitest";
import { fitTrackGeometry, observeTrackResize } from "./trackMapGeometry";

describe("fitTrackGeometry", () => {
  it("fits the map inside the usable area while keeping equal x/y scale", () => {
    const geometry = fitTrackGeometry({
      width: 600,
      height: 200,
      topInset: 68,
      bottomInset: 8,
      leftInset: 0,
      rightInset: 0,
      minX: 0,
      maxX: 2,
      minY: 0,
      maxY: 1,
      zoom: 1,
    });

    expect(geometry.contentHeight).toBeLessThanOrEqual(124);
    expect(geometry.contentWidth / geometry.contentHeight).toBeCloseTo(2, 6);
    expect(geometry.scaleX).toBeCloseTo(geometry.scaleY, 6);
  });

  it("repaints when the canvas CSS size changes", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = observe;
        disconnect = disconnect;
      }
    );
    const repaint = vi.fn();
    const cleanup = observeTrackResize({} as Element, repaint);
    expect(observe).toHaveBeenCalledOnce();
    cleanup();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
