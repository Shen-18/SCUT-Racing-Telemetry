import { describe, expect, it } from "vitest";
import { buildChannelColorMap, matchNamedChannelColor, SPEED_COLOR } from "./channelColors";

describe("matchNamedChannelColor", () => {
  it("maps SPEED family to the foreground token", () => {
    expect(matchNamedChannelColor("Speed")).toBe(SPEED_COLOR);
    expect(matchNamedChannelColor("GPS Speed")).toBe(SPEED_COLOR);
    expect(matchNamedChannelColor("GPS Speed (AiM Interpolated)")).toBe(SPEED_COLOR);
    expect(matchNamedChannelColor("speed")).toBe(SPEED_COLOR);
  });

  it("does not treat Distance channels as speed", () => {
    expect(matchNamedChannelColor("Distance on GPS Speed")).toBeNull();
    expect(matchNamedChannelColor("Distance")).toBeNull();
  });

  it("maps the six fixed palette channels", () => {
    expect(matchNamedChannelColor("Engine RPM")).toBe("#B14BF4");
    expect(matchNamedChannelColor("Throttle")).toBe("#43B02A");
    expect(matchNamedChannelColor("Brake")).toBe("#E10600");
    expect(matchNamedChannelColor("Steering Angle")).toBe("#28F3D2");
    expect(matchNamedChannelColor("Gear")).toBe("#FFD100");
    expect(matchNamedChannelColor("LAT G")).toBe("#FF8001");
    expect(matchNamedChannelColor("Lateral Acc")).toBe("#FF8001");
  });

  it("returns null for unmatched channels (no false Latitude match)", () => {
    expect(matchNamedChannelColor("GPS Latitude")).toBeNull();
    expect(matchNamedChannelColor("Battery_V")).toBeNull();
    expect(matchNamedChannelColor("LoggerTemp")).toBeNull();
  });
});

describe("buildChannelColorMap", () => {
  it("assigns named channels directly and pools the rest deterministically", () => {
    const names = [
      "GPS Speed (AiM Interpolated)",
      "Engine RPM",
      "Battery_V",
      "Oil Press",
      "Fuel Level",
    ];
    const map = buildChannelColorMap(names);
    expect(map["GPS Speed (AiM Interpolated)"]).toBe(SPEED_COLOR);
    expect(map["Engine RPM"]).toBe("#B14BF4");
    expect(map["Battery_V"]).toBe("#3A9BFF");
    expect(map["Oil Press"]).toBe("#FF5D8F");
    expect(map["Fuel Level"]).toBe("#00D9B0");
  });

  it("is deterministic for the same input order", () => {
    const names = ["A_alpha", "GPS Speed", "B_beta", "C_gamma"];
    expect(buildChannelColorMap(names)).toEqual(buildChannelColorMap(names));
    // 池分配跟随输入顺序：反转后首个未匹配通道拿池首色
    const reversed = buildChannelColorMap(["C_gamma", "B_beta"]);
    expect(reversed["C_gamma"]).toBe("#3A9BFF");
    expect(reversed["B_beta"]).toBe("#FF5D8F");
  });

  it("cycles the pool when it is exhausted", () => {
    // 池 6 色：第 7 个未匹配通道回到池首色
    const map = buildChannelColorMap(["X1", "X2", "X3", "X4", "X5", "X6", "X7"]);
    expect(map["X7"]).toBe("#3A9BFF");
  });

  it("keeps first occurrence when duplicate names appear", () => {
    const map = buildChannelColorMap(["Y_one", "Y_one"]);
    expect(Object.keys(map)).toEqual(["Y_one"]);
  });
});
