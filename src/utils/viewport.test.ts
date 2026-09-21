import { describe, expect, it } from "vitest";
import {
  clampViewport,
  cursorFraction,
  fullFraction,
  panViewport,
  zoomAtViewport,
} from "./viewport";

describe("zoomAtViewport (B.11 焦点缩放)", () => {

  it("keeps the focal time fixed while zooming in", () => {
    const vp = { start: 10, end: 30 };
    const focal = 0.5; // 焦点 = t=20
    const next = zoomAtViewport(vp, 90, focal, 1 / 1.18);
    const span = next.end - next.start;
    expect(span).toBeCloseTo(20 / 1.18, 6);
    expect(next.start + focal * span).toBeCloseTo(20, 6);
  });

  it("zooms out by the same factor and clamps to full duration", () => {
    const next = zoomAtViewport({ start: 40, end: 50 }, 90, 0.5, 1.18);
    expect(next.end - next.start).toBeCloseTo(11.8, 6);
    const maxed = zoomAtViewport({ start: 0, end: 89.9 }, 90, 0.3, 1.18);
    expect(maxed.end - maxed.start).toBeCloseTo(90, 6);
    expect(maxed.start).toBe(0);
  });

  it("never goes below the 2s minimum window", () => {
    const tiny = zoomAtViewport({ start: 10, end: 12.5 }, 90, 0.5, 1 / 5);
    expect(tiny.end - tiny.start).toBe(2);
  });
});

describe("panViewport (B.11 窗口跟手)", () => {
  it("moves the window right when dragging right, by window span", () => {
    const vp = { start: 10, end: 30 };
    const next = panViewport(vp, 90, 0.25); // 拖过 1/4 个窗口宽度
    expect(next.start).toBeCloseTo(15, 6);
    expect(next.end).toBeCloseTo(35, 6);
  });

  it("clamps at both edges", () => {
    const left = panViewport({ start: 5, end: 25 }, 90, -1);
    expect(left.start).toBe(0);
    expect(left.end).toBe(20);
    const right = panViewport({ start: 75, end: 90 }, 90, 1);
    expect(right.end).toBe(90);
    expect(right.start).toBe(75);
  });
});

describe("clampViewport / cursor / full fractions", () => {
  it("clamps window size and position", () => {
    expect(clampViewport({ start: -5, end: 100 }, 90)).toEqual({ start: 0, end: 90 });
    expect(clampViewport({ start: 10, end: 12 }, 90)).toEqual({ start: 10, end: 12 });
    expect(clampViewport({ start: 0, end: 1 }, 90).end).toBe(2);
  });

  it("cursorFraction returns null outside the window", () => {
    const vp = { start: 10, end: 30 };
    expect(cursorFraction(20, vp)).toBe(0.5);
    expect(cursorFraction(5, vp)).toBeNull();
    expect(cursorFraction(35, vp)).toBeNull();
  });

  it("fullFraction clamps to [0,1]", () => {
    expect(fullFraction(-1, 90)).toBe(0);
    expect(fullFraction(45, 90)).toBe(0.5);
    expect(fullFraction(200, 90)).toBe(1);
    expect(fullFraction(1, 0)).toBe(0);
  });
});
