import { describe, expect, it } from "vitest";
import { selectActiveChannel, selectDefaultSpeedChannel } from "./client";

describe("selectDefaultSpeedChannel", () => {
  it("prioritizes real physical speed over AiM Interpolated and raw GPS Speed", () => {
    const channels = [
      { key: "Battery_V", name: "Battery_V", source: "Standard" },
      { key: "Distance on GPS Speed", name: "Distance on GPS Speed", source: "DerivedCalc" },
      { key: "GPS Speed", name: "GPS Speed", source: "DerivedGps" },
      { key: "GPS Speed (AiM Interpolated)", name: "GPS Speed (AiM Interpolated)", source: "Gps" },
      { key: "VehSpd", name: "VehSpd", source: "Standard" },
      { key: "Engine_RPM", name: "Engine_RPM", source: "Standard" },
    ];
    expect(selectDefaultSpeedChannel(channels)).toBe("VehSpd");
  });

  it("falls back to raw 'GPS Speed' when official interpolated speed is absent", () => {
    const channels = [
      { key: "Battery_V", name: "Battery_V", source: "Standard" },
      { key: "Distance on GPS Speed", name: "Distance on GPS Speed", source: "DerivedCalc" },
      { key: "GPS Speed", name: "GPS Speed", source: "DerivedGps" },
      { key: "Engine_RPM", name: "Engine_RPM", source: "Standard" },
    ];
    expect(selectDefaultSpeedChannel(channels)).toBe("GPS Speed");
  });

  it("selects standard channel named 'Speed' when present", () => {
    const channels = [
      { key: "RPM", name: "RPM", source: "Standard" },
      { key: "Speed", name: "Speed", source: "Standard" },
    ];
    expect(selectDefaultSpeedChannel(channels)).toBe("Speed");
  });

  it("selects channel where key or name contains 'speed' case-insensitively", () => {
    const channels = [
      { key: "RPM", name: "RPM", source: "Standard" },
      { key: "vehicle_speed_kmh", name: "Vehicle Speed", source: "Standard" },
    ];
    expect(selectDefaultSpeedChannel(channels)).toBe("vehicle_speed_kmh");
  });

  it("does not select 'Distance on GPS Speed' when no actual speed channel is present, falls back to first channel", () => {
    const channels = [
      { key: "Battery_V", name: "Battery_V", source: "Standard" },
      { key: "Distance on GPS Speed", name: "Distance on GPS Speed", source: "DerivedCalc" },
    ];
    // Distance is distance, not speed; should fall back to first channel
    expect(selectDefaultSpeedChannel(channels)).toBe("Battery_V");
  });

  it("falls back to the first channel when no speed channel exists", () => {
    const channels = [
      { key: "Engine_RPM", name: "Engine_RPM", source: "Standard" },
      { key: "Water_Temp", name: "Water_Temp", source: "Standard" },
    ];
    expect(selectDefaultSpeedChannel(channels)).toBe("Engine_RPM");
  });

  it("returns undefined when channels array is empty or null", () => {
    expect(selectDefaultSpeedChannel([])).toBeUndefined();
    expect(selectDefaultSpeedChannel(undefined)).toBeUndefined();
    expect(selectDefaultSpeedChannel(null)).toBeUndefined();
  });
});

describe("selectActiveChannel", () => {
  const channels = [
    { key: "Speed", name: "Speed" },
    { key: "RPM", name: "RPM" },
  ];

  it("uses the most recently checked channel instead of locking the default speed", () => {
    expect(selectActiveChannel(channels, ["Speed", "RPM"])).toBe("RPM");
  });

  it("falls back to the default speed channel when none are checked", () => {
    expect(selectActiveChannel(channels, [])).toBe("Speed");
  });
});
