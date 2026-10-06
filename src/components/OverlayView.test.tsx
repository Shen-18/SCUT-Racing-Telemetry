import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverlayBindingPanel, OverlaySelector } from "./OverlayView";
import type { RecordSummary } from "../api/client";

const record = (overrides: Partial<RecordSummary>): RecordSummary => ({
  file_hash: "a",
  file_name: "session.xrk",
  file_type: "xrk",
  session: "Practice",
  vehicle: "SCUT-24",
  racer: "LIN",
  record_date: "2026-09-30",
  start_time: "14:32:10",
  duration: 504,
  channel_count: 92,
  file_size: 1000,
  source_mtime_unix: 100,
  cache_state: "Ready",
  ...overrides,
});

describe("OverlaySelector", () => {
  it("renders the video selection workspace with selected record details", () => {
    const html = renderToStaticMarkup(
      <OverlaySelector
        records={[
          record({ file_hash: "a" }),
          record({ file_hash: "b", racer: "ZHOU", start_time: "15:05:00" }),
        ]}
        selectedHash="a"
        onSelect={() => {}}
        onContinue={() => {}}
      />,
    );

    expect(html).toContain("SELECT SOURCE");
    expect(html).toContain("OVERLAY");
    expect(html).toContain("overlay-record");
    expect(html).toContain("LIN");
    expect(html).toContain("SCUT-24");
    expect(html).toContain("进入操作台");
    expect(html).toContain("#2A4A98");
    expect(html).toContain("分类");
    expect(html).toContain("按日期");
  });

  it("separates all records by date when no group is selected", () => {
    const html = renderToStaticMarkup(
      <OverlaySelector
        records={[
          record({ file_hash: "a", record_date: "2026-09-30" }),
          record({ file_hash: "b", record_date: "2026-10-01" }),
        ]}
        selectedHash={null}
        onSelect={() => {}}
        onContinue={() => {}}
      />,
    );

    expect(html).toContain('data-testid="overlay-date-group-2026-09-30"');
    expect(html).toContain('data-testid="overlay-date-group-2026-10-01"');
  });

  it("shows an empty selection prompt before a record is chosen", () => {
    const html = renderToStaticMarkup(
      <OverlaySelector records={[record({})]} selectedHash={null} onSelect={() => {}} onContinue={() => {}} />,
    );

    expect(html).toContain("SELECT A RECORD");
    expect(html).toContain("请先选择一条遥测记录");
    expect(html).toContain('disabled=""');
  });
});


describe("OverlayBindingPanel", () => {
  it("mirrors the original workbench binding groups and auto matches candidates", () => {
    const html = renderToStaticMarkup(
      <OverlayBindingPanel
        fileHash="demo"
        channels={[
          { key: "VehSpd", name: "VehSpd", unit: "km/h", source: "AIM", dtype: "f64", sample_rate_hz: 100 },
          { key: "GPS Latitude", name: "GPS Latitude", unit: "deg", source: "AIM", dtype: "f64", sample_rate_hz: 10 },
          { key: "FL Torque", name: "FL Torque", unit: "Nm", source: "AIM", dtype: "f64", sample_rate_hz: 100 },
        ]}
      />,
    );

    expect(html).toContain("CHANNEL BINDINGS");
    expect(html).toContain("车速 km/h");
    expect(html).toContain("GPS 纬度");
    expect(html).toContain("FL 扭矩 Nm");
    expect(html).toContain('value="VehSpd"');
    expect(html).toContain("（不绑定）");
  });
});
