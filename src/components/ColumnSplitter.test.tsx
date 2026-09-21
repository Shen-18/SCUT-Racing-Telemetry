import { describe, expect, it } from "vitest";
import { columnWidthFromDrag, clampSplitterWidth } from "./ColumnSplitter";

describe("columnWidthFromDrag", () => {
  it("left splitter grows when dragging right", () => {
    expect(columnWidthFromDrag("left", 280, 40)).toBe(320);
    expect(columnWidthFromDrag("left", 280, -60)).toBe(220);
  });

  it("right splitter grows when dragging left", () => {
    expect(columnWidthFromDrag("right", 310, -70)).toBe(380);
    expect(columnWidthFromDrag("right", 310, 70)).toBe(240);
  });
});

describe("clampSplitterWidth", () => {
  it("clamps to range and rounds", () => {
    expect(clampSplitterWidth(100, 220, 420)).toBe(220);
    expect(clampSplitterWidth(999, 220, 420)).toBe(420);
    expect(clampSplitterWidth(280.4, 220, 420)).toBe(280);
    expect(clampSplitterWidth(Number.NaN, 240, 480)).toBe(240);
  });
});
