import { describe, expect, it } from "vitest";
import { formatClockTime, formatDurationShort } from "./time";

describe("formatClockTime", () => {
  it("formats m:ss.mmm by default", () => {
    expect(formatClockTime(0)).toBe("0:00.000");
    expect(formatClockTime(1.5)).toBe("0:01.500");
    expect(formatClockTime(102.871)).toBe("1:42.871");
  });

  it("supports fewer fractional digits", () => {
    expect(formatClockTime(1196.3, 1)).toBe("19:56.3");
  });

  it("clamps negatives and handles non-finite input", () => {
    expect(formatClockTime(-5)).toBe("0:00.000");
    expect(formatClockTime(Number.NaN)).toBe("--:--.000");
    expect(formatClockTime(Number.POSITIVE_INFINITY)).toBe("--:--.000");
  });
});

describe("formatDurationShort", () => {
  it("formats session duration with one decimal", () => {
    expect(formatDurationShort(89)).toBe("1:29.0");
    expect(formatDurationShort(1196.34)).toBe("19:56.3");
  });

  it("handles invalid input", () => {
    expect(formatDurationShort(-1)).toBe("--:--.-");
    expect(formatDurationShort(Number.NaN)).toBe("--:--.-");
  });
});
