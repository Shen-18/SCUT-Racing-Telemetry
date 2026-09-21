import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cacheStateLabel,
  filterRecords,
  groupRecords,
  LibraryHomeView,
  type RecordGroup,
} from "./LibraryView";
import type { RecordSummary } from "../api/client";

const record = (overrides: Partial<RecordSummary>): RecordSummary => ({
  file_hash: "h",
  file_name: "AGX.xrk",
  file_type: "xrk",
  session: "Madring",
  vehicle: "SCUT-24",
  racer: "LIN",
  record_date: "2026-09-15",
  start_time: "10:00:00",
  duration: 89,
  channel_count: 92,
  file_size: 626_948,
  source_mtime_unix: 1000,
  cache_state: "Ready",
  ...overrides,
});

const records: RecordSummary[] = [
  record({ file_hash: "a", file_name: "AGX.xrk", vehicle: "SCUT-24", record_date: "2026-09-15", source_mtime_unix: 2000 }),
  record({ file_hash: "b", file_name: "Du.xrk", vehicle: "SCUT-25", record_date: "2026-09-14", source_mtime_unix: 3000 }),
  record({ file_hash: "c", file_name: "AGX_test.xrk", vehicle: "SCUT-24", record_date: "2026-09-15", source_mtime_unix: 1000 }),
];

describe("filterRecords", () => {
  it("filters across name, session, vehicle and racer, case-insensitive", () => {
    expect(filterRecords(records, "agx").map((r) => r.file_hash)).toEqual(["a", "c"]);
    expect(filterRecords(records, "scut-25").map((r) => r.file_hash)).toEqual(["b"]);
    expect(filterRecords(records, "LIN").length).toBe(3);
    expect(filterRecords(records, "  ")).toEqual(records);
  });
});

describe("groupRecords", () => {
  it("groups by recording date when category is time", () => {
    const groups: RecordGroup[] = groupRecords(records, "time");
    expect(groups.map((g) => g.key)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(groups[0].records.map((r) => r.file_hash)).toEqual(["b"]);
    expect(groups[1].records.map((r) => r.file_hash)).toEqual(["a", "c"]);
  });

  it("groups by vehicle when category is vehicle, newest group first", () => {
    const groups = groupRecords(records, "vehicle");
    expect(groups.map((g) => g.key)).toEqual(["SCUT-25", "SCUT-24"]);
    expect(groups[1].records.map((r) => r.file_hash)).toEqual(["a", "c"]);
  });

  it("falls back to placeholder keys for blank fields", () => {
    const blank = [record({ file_hash: "x", record_date: "  ", vehicle: "" })];
    expect(groupRecords(blank, "time")[0].key).toBe("未知日期");
    expect(groupRecords(blank, "vehicle")[0].key).toBe("未知赛车");
  });
});

describe("cacheStateLabel", () => {
  it("maps cache states to Chinese labels with tones", () => {
    expect(cacheStateLabel("Ready")).toEqual({ text: "就绪", tone: "ok" });
    expect(cacheStateLabel("Failed")).toEqual({ text: "异常", tone: "bad" });
    expect(cacheStateLabel("PyramidPartial")).toEqual({ text: "部分缓存", tone: "dim" });
    expect(cacheStateLabel("MetadataReady")).toEqual({ text: "未缓存", tone: "dim" });
  });
});

describe("LibraryHomeView", () => {
  it("renders the compact detail columns without filename or cache state", () => {
    const html = renderToStaticMarkup(
      <LibraryHomeView
        records={records}
        error={null}
        query=""
        category="time"
        selectedGroup={null}
        selected={new Set<string>()}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onGroupChange={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
        onPickFiles={() => {}}
        onToggleSelect={() => {}}
        onExportOne={() => {}}
        onExportSelected={() => {}}
        onExportDay={() => {}}
      />
    );
    expect(html).toContain("按日期");
    expect(html).toContain("2026-09-14");
    expect(html).toContain("10:00:00");
    expect(html).toContain("开始时间");
    expect(html).toContain("车手");
    expect(html).toContain("车辆");
    expect(html).toContain("时长");
    expect(html).toContain("操作");
    expect(html).toContain("1:29.0");
    expect(html).not.toContain("缓存");
    expect(html).not.toContain(">就绪<");
    expect(html).toContain("3 条记录");
  });

  it("renders the empty-library guide", () => {
    const html = renderToStaticMarkup(
      <LibraryHomeView
        records={[]}
        error={null}
        query=""
        category="time"
        selectedGroup={null}
        selected={new Set<string>()}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onGroupChange={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
        onPickFiles={() => {}}
        onToggleSelect={() => {}}
        onExportOne={() => {}}
        onExportSelected={() => {}}
        onExportDay={() => {}}
      />
    );
    expect(html).toContain("导入遥测文件开始分析");
    expect(html).toContain("选择文件导入");
  });

  it("renders skeleton while loading and error banner with retry", () => {
    const loading = renderToStaticMarkup(
      <LibraryHomeView
        records={null}
        error={null}
        query=""
        category="time"
        selectedGroup={null}
        selected={new Set<string>()}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onGroupChange={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
        onPickFiles={() => {}}
        onToggleSelect={() => {}}
        onExportOne={() => {}}
        onExportSelected={() => {}}
        onExportDay={() => {}}
      />
    );
    expect(loading).toContain("library-skeleton");

    const failed = renderToStaticMarkup(
      <LibraryHomeView
        records={null}
        error="invoke failed"
        query=""
        category="time"
        selectedGroup={null}
        selected={new Set<string>()}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onGroupChange={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
        onPickFiles={() => {}}
        onToggleSelect={() => {}}
        onExportOne={() => {}}
        onExportSelected={() => {}}
        onExportDay={() => {}}
      />
    );
    expect(failed).toContain("invoke failed");
    expect(failed).toContain("重试");
  });

  it("shows no-match hint when the query filters everything out", () => {
    const html = renderToStaticMarkup(
      <LibraryHomeView
        records={records}
        error={null}
        query="zzz"
        category="time"
        selectedGroup={null}
        selected={new Set<string>()}
        onQueryChange={() => {}}
        onCategoryChange={() => {}}
        onGroupChange={() => {}}
        onOpen={() => {}}
        onDelete={() => {}}
        onRetry={() => {}}
        onPickFiles={() => {}}
        onToggleSelect={() => {}}
        onExportOne={() => {}}
        onExportSelected={() => {}}
        onExportDay={() => {}}
      />
    );
    expect(html).toContain("无匹配记录");
  });
});
