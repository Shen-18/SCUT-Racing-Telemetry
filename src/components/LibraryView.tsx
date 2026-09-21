import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as client from "../api/client";
import type { RecordSummary } from "../api/client";
import { LEFT_WIDTH_RANGE, useAppStore } from "../state/appStore";
import { ColumnSplitter } from "./ColumnSplitter";
import { formatDateTime, formatDurationShort } from "../utils/time";

// 资料库主页（2026-09-16 负责人重构）：
// 一级栏（AppShell 红栏）之下是分类 + 数据详情双栏；
// 左侧 = 分类切换（按日期/按赛车）+ 分组统计列表（组名 + 条数，点击过滤）；
// 右侧 = 选中分组的记录明细（开始时间/车手/车辆/时长/操作）；赛道字段后续补充。
// 导入入口位于数据详情标题行右上角，另支持原生拖入。

export type LibraryCategory = "time" | "vehicle";

export interface RecordGroup {
  key: string;
  records: RecordSummary[];
}

export function filterRecords(
  records: RecordSummary[],
  query: string
): RecordSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return records;
  return records.filter((r) =>
    [r.file_name, r.session, r.vehicle, r.racer]
      .map((f) => f.toLowerCase())
      .some((f) => f.includes(needle))
  );
}

export function groupRecords(
  records: RecordSummary[],
  category: LibraryCategory
): RecordGroup[] {
  const keyOf = (r: RecordSummary) =>
    category === "time"
      ? r.record_date.trim() || "未知日期"
      : r.vehicle.trim() || "未知赛车";
  const map = new Map<string, RecordSummary[]>();
  for (const record of records) {
    const key = keyOf(record);
    const bucket = map.get(key);
    if (bucket) bucket.push(record);
    else map.set(key, [record]);
  }
  const groups = [...map.entries()].map(([key, recs]) => ({ key, records: recs }));
  for (const group of groups) {
    group.records.sort((a, b) => b.source_mtime_unix - a.source_mtime_unix);
  }
  groups.sort(
    (a, b) =>
      Math.max(...b.records.map((r) => r.source_mtime_unix)) -
      Math.max(...a.records.map((r) => r.source_mtime_unix))
  );
  return groups;
}

export function cacheStateLabel(state: string): { text: string; tone: "ok" | "bad" | "dim" } {
  if (state === "Ready") return { text: "就绪", tone: "ok" };
  if (state === "Failed" || state === "Invalid") return { text: "异常", tone: "bad" };
  if (state === "MetadataReady" || state === "Missing") return { text: "未缓存", tone: "dim" };
  return { text: "部分缓存", tone: "dim" };
}

const RED_BLOCK_STYLE: React.CSSProperties = {
  width: "3px",
  height: "12px",
  background: "var(--red)",
  display: "inline-block",
  flex: "none",
};

const PANEL_TITLE_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
  fontWeight: 700,
  fontSize: "15px",
  letterSpacing: "2px",
  color: "var(--dim)",
  padding: "12px 14px 8px",
  flex: "none",
};

const GRID_COLUMNS = "28px 120px 100px minmax(120px,1fr) 84px 72px";

function headerCellStyle(): React.CSSProperties {
  return {
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "1px",
    color: "var(--dim2)",
    padding: "4px 8px",
    textAlign: "left",
    whiteSpace: "nowrap",
  };
}

export interface LibraryHomeViewProps {
  records: RecordSummary[] | null;
  error: string | null;
  query: string;
  category: LibraryCategory;
  selectedGroup: string | null;
  selected: ReadonlySet<string>;
  onQueryChange(query: string): void;
  onCategoryChange(category: LibraryCategory): void;
  onGroupChange(group: string | null): void;
  onOpen(fileHash: string): void;
  onDelete(fileHash: string): void;
  onRetry(): void;
  onPickFiles(): void;
  onToggleSelect(fileHash: string): void;
  onExportOne(fileHash: string): void;
  onExportSelected(): void;
  onExportDay(dayKey: string): void;
}

export const LibraryHomeView: React.FC<LibraryHomeViewProps> = ({
  records,
  error,
  query,
  category,
  selectedGroup,
  selected,
  onQueryChange,
  onCategoryChange,
  onGroupChange,
  onOpen,
  onDelete,
  onRetry,
  onPickFiles,
  onToggleSelect,
  onExportOne,
  onExportSelected,
  onExportDay,
}) => {
  const categoryWidth = useAppStore((s) => s.leftWidth);
  const setCategoryWidth = useAppStore((s) => s.setLeftWidth);
  const groups = useMemo(
    () => (records ? groupRecords(records, category) : []),
    [records, category]
  );
  const total = records ? records.length : 0;
  // 右侧明细 = 选中分组 ∩ 搜索词
  const visible = useMemo(() => {
    if (records === null) return null;
    let base = records;
    if (selectedGroup !== null) {
      const group = groups.find((g) => g.key === selectedGroup);
      base = group ? group.records : [];
    }
    return filterRecords(base, query);
  }, [records, groups, selectedGroup, query]);

  const categories: Array<{ id: LibraryCategory; label: string; en: string }> = [
    { id: "time", label: "按日期", en: "BY DATE" },
    { id: "vehicle", label: "按赛车", en: "BY CAR" },
  ];

  return (
    <div style={{ display: "flex", width: "100%", flex: 1, minHeight: 0, color: "var(--text)" }}>
      {/* 左侧：分类 + 分组统计列表 */}
      <aside
        data-testid="library-categories"
        style={{
          width: `${categoryWidth}px`,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg)",
          minHeight: 0,
        }}
      >
        <div style={PANEL_TITLE_STYLE}>
          <span style={RED_BLOCK_STYLE} />
          分类
        </div>
        <div style={{ display: "flex", gap: "6px", padding: "0 14px 10px", flex: "none" }}>
          {categories.map((cat) => {
            const active = cat.id === category;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  onCategoryChange(cat.id);
                  onGroupChange(null);
                }}
                style={{
                  flex: 1,
                  padding: "6px 0",
                  background: active ? "var(--red)" : "var(--panel)",
                  border: "1px solid",
                  borderColor: active ? "var(--red)" : "var(--line)",
                  color: active ? "#fff" : "var(--dim)",
                  fontFamily: "inherit",
                  fontWeight: 700,
                  fontSize: "14px",
                  letterSpacing: "1px",
                  cursor: "pointer",
                }}
                title={cat.en}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
        {/* 分组统计列表：组名 + 条数；"全部" 置顶 */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div
            data-testid="group-all"
            onClick={() => onGroupChange(null)}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 14px",
              cursor: "pointer",
              background: selectedGroup === null ? "var(--bg2)" : "transparent",
              borderLeft: selectedGroup === null ? "3px solid var(--red)" : "3px solid transparent",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "14px", letterSpacing: "0.5px" }}>全部</span>
            <span className="tnum" style={{ marginLeft: "auto", fontSize: "13px", color: "var(--dim2)", fontWeight: 700 }}>
              {total}
            </span>
          </div>
          {groups.map((group) => {
            const active = group.key === selectedGroup;
            return (
              <div
                key={group.key}
                data-testid={`group-${group.key}`}
                onClick={() => onGroupChange(active ? null : group.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: active ? "var(--bg2)" : "transparent",
                  borderLeft: active ? "3px solid var(--red)" : "3px solid transparent",
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "14px",
                    letterSpacing: "0.5px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={group.key}
                >
                  {group.key}
                </span>
                <span className="tnum" style={{ marginLeft: "auto", fontSize: "13px", color: "var(--dim2)", fontWeight: 700, flex: "none" }}>
                  {group.records.length}
                </span>
              </div>
            );
          })}
        </div>
      </aside>

      <ColumnSplitter
        side="left"
        startWidth={categoryWidth}
        minWidth={LEFT_WIDTH_RANGE.min}
        maxWidth={LEFT_WIDTH_RANGE.max}
        onResize={setCategoryWidth}
      />

      {/* 右侧：记录明细 */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div
          data-testid="library-detail-header"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            minHeight: "52px",
            padding: "8px 16px",
            borderBottom: "1px solid var(--line)",
            flex: "none",
          }}
        >
          <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "16px", letterSpacing: "1.5px", color: "var(--dim)" }}>
            数据详情
          </span>
          {records !== null && total > 0 && (
            <input
              data-testid="library-search"
              type="text"
              placeholder="搜索车手 / 车辆…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              style={{
                width: "220px",
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: "2px",
                color: "var(--text)",
                padding: "6px 9px",
                fontSize: "14px",
                fontFamily: "inherit",
              }}
            />
          )}
          {records !== null && (
            <span className="tnum" style={{ fontSize: "13px", color: "var(--dim2)" }}>
              {total} 条记录{selectedGroup !== null ? ` · ${selectedGroup}` : ""}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {selected.size > 0 && (
            <span data-testid="bulk-bar" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="tnum" style={{ fontSize: "13px", fontWeight: 700, color: "var(--red)" }}>
                已选 {selected.size} 条
              </span>
              <button
                data-testid="export-selected"
                onClick={onExportSelected}
                className="primary-button"
                style={{ background: "var(--red)", border: "1px solid var(--red)", color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", letterSpacing: "1px", padding: "5px 14px", cursor: "pointer" }}
              >
                导出所选
              </button>
            </span>
          )}
          {category === "time" && selectedGroup !== null && (
            <button
              data-testid="export-day"
              onClick={() => onExportDay(selectedGroup)}
              className="ghost-button"
              style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--dim)", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", letterSpacing: "1px", padding: "5px 14px", cursor: "pointer" }}
              title={`导出 ${selectedGroup} 的全部记录`}
            >
              导出当日
            </button>
          )}
          <button
            data-testid="pick-files"
            onClick={onPickFiles}
            className="primary-button"
            style={{ background: "var(--red)", border: "1px solid var(--red)", color: "#fff", fontFamily: "inherit", fontWeight: 700, fontSize: "14px", letterSpacing: "1px", padding: "7px 14px", cursor: "pointer", whiteSpace: "nowrap" }}
            title="从文件管理器选择 xrk/xrz/csv/zip（可多选）"
          >
            选择文件导入
          </button>
        </div>
        {error ? (
          <div style={{ margin: "16px", borderLeft: "3px solid var(--red)", background: "var(--bg2)", padding: "10px 14px", fontSize: "14px" }}>
            <div>{error}</div>
            <button
              onClick={onRetry}
              className="ghost-button"
              style={{ marginTop: "8px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", fontFamily: "inherit", fontWeight: 700, fontSize: "13px", padding: "4px 12px", cursor: "pointer" }}
            >
              重试
            </button>
          </div>
        ) : records === null ? (
          <div style={{ padding: "12px 16px" }} data-testid="library-skeleton">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: "14px", margin: "10px 0", width: `${92 - (i % 4) * 12}%` }} />
            ))}
          </div>
        ) : total === 0 ? (
          <div style={{ margin: "auto", textAlign: "center", color: "var(--dim2)" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                margin: "0 auto 12px",
                background: "var(--red)",
                transform: "skewX(-10deg)",
                display: "grid",
                placeItems: "center",
              }}
            >
              <span className="f1" style={{ transform: "skewX(10deg)", fontWeight: 700, color: "#fff", fontSize: "16px" }}>
                DB
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "16px", letterSpacing: "1px" }}>导入遥测文件开始分析</div>
            <div style={{ fontSize: "13px", letterSpacing: "1.5px", marginTop: "4px" }}>
              点击右上角「选择文件导入」，或直接把文件拖入本页
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                gap: "0 8px",
                padding: "0 16px",
                borderBottom: "1px solid var(--line)",
                flex: "none",
              }}
            >
              <span />
                <span style={headerCellStyle()}>开始时间</span>
                <span style={headerCellStyle()}>车手</span>
                <span style={headerCellStyle()}>车辆</span>
                <span style={headerCellStyle()}>时长</span>
                <span style={headerCellStyle()}>操作</span>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {visible!.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--dim2)", fontSize: "14px", fontWeight: 600 }}>
                  无匹配记录 / NO MATCH
                </div>
              ) : (
                visible!.map((record) => {
                  return (
                    <div
                      key={record.file_hash}
                      data-testid="library-row"
                      tabIndex={0}
                      title="双击打开分析 / DOUBLE-CLICK TO OPEN"
                      onDoubleClick={() => onOpen(record.file_hash)}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(record.file_hash)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: GRID_COLUMNS,
                        gap: "0 8px",
                        alignItems: "center",
                        margin: "0 16px",
                        padding: "7px 8px",
                        borderBottom: "1px solid var(--line)",
                        cursor: "pointer",
                        fontSize: "14px",
                        background: selected.has(record.file_hash) ? "var(--bg2)" : undefined,
                      }}
                      className="library-row"
                    >
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleSelect(record.file_hash);
                        }}
                        style={{
                          width: "14px",
                          height: "14px",
                          border: `1.5px solid ${selected.has(record.file_hash) ? "var(--text)" : "var(--dim2)"}`,
                          flex: "none",
                          position: "relative",
                          display: "inline-block",
                          cursor: "pointer",
                        }}
                        title="选中以便批量导出"
                      >
                        {selected.has(record.file_hash) && (
                          <span style={{ position: "absolute", inset: "2px", background: "var(--text)" }} />
                        )}
                      </span>
                      <span
                        className="tnum"
                        style={{ color: "var(--dim)", whiteSpace: "nowrap" }}
                        title={`文件时间 ${formatDateTime(record.source_mtime_unix)}`}
                      >
                        {record.start_time || "—"}
                      </span>
                      <span style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {record.racer || "—"}
                      </span>
                      <span style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={record.vehicle}>
                        {record.vehicle || "—"}
                      </span>
                      <span className="tnum" style={{ color: "var(--text)" }}>
                        {formatDurationShort(record.duration)}
                      </span>
                      <span style={{ display: "flex", gap: "2px", justifyContent: "flex-end" }}>
                        <button
                          aria-label={`导出 ${record.file_name}`}
                          title="导出此记录的 CSV"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportOne(record.file_hash);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--dim)",
                            cursor: "pointer",
                            fontSize: "15px",
                            padding: "2px 4px",
                          }}
                        >
                          ⬇
                        </button>
                        <button
                          aria-label={`删除 ${record.file_name}`}
                          title="删除此记录（原始文件不受影响）"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(record.file_hash);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--dim2)",
                            cursor: "pointer",
                            fontSize: "15px",
                            padding: "2px 4px",
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export const LibraryView: React.FC = () => {
  const openDataset = useAppStore((s) => s.openDataset);
  const trackImport = useAppStore((s) => s.trackImport);
  const [records, setRecords] = useState<RecordSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategory>("time");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reloadTick, setReloadTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // 导入未完成时轮询记录列表，让新记录自动出现
  useEffect(() => {
    if (!importing) return;
    const timer = globalThis.setInterval(() => setReloadTick((t) => t + 1), 1000);
    return () => globalThis.clearInterval(timer);
  }, [importing]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    client
      .listRecords("")
      .then((list) => {
        if (!cancelled) {
          setRecords(list);
          setImporting(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);


  const runImport = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    setImporting(true);
    try {
      const outcomes = await client.importFiles(paths);
      for (const outcome of outcomes) {
        if (outcome.status === "queued" && outcome.job_id !== null) {
          trackImport(outcome.job_id);
        }
      }
      const failed = outcomes.filter((o) => o.status === "failed");
      const duplicated = outcomes.filter((o) => o.status === "duplicate");
      const queued = outcomes.filter((o) => o.status === "queued");
      const parts: string[] = [];
      if (queued.length > 0) parts.push(`${queued.length} 个文件开始导入`);
      if (duplicated.length > 0)
        parts.push(`${duplicated.length} 个重复跳过（${duplicated.map((d) => d.file_name).join("、")}）`);
      if (failed.length > 0)
        parts.push(`${failed.length} 个失败（${failed.map((f) => `${f.file_name}: ${f.message ?? ""}`).join("；")}）`);
      setNotice(parts.length > 0 ? parts.join("；") : null);
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  }, [trackImport]);

  // WebView2 拦截 HTML5 拖放，必须用 Tauri 原生拖放事件（enter/over 灰化、drop 导入）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    client
      .onFileDrop({
        onEnter: () => setDragOver(true),
        onLeave: () => setDragOver(false),
        onDrop: (paths) => {
          setDragOver(false);
          void runImport(paths);
        },
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 非 Tauri 环境（单测/浏览器预览）忽略
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [runImport]);

  const handlePickFiles = useCallback(async () => {
    try {
      const paths = await client.pickImportFiles();
      await runImport(paths);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runImport]);

  const exportTo = useCallback(async (hashes: string[]) => {
    if (hashes.length === 0) return;
    try {
      const dir = await client.pickExportFolder();
      if (!dir) return;
      const outcomes = await client.exportRecords(hashes, dir);
      const ok = outcomes.filter((o) => o.status === "exported");
      const miss = outcomes.filter((o) => o.status === "missing");
      const bad = outcomes.filter((o) => o.status === "failed");
      const parts: string[] = [];
      if (ok.length > 0) parts.push(`${ok.length} 条已导出到 ${dir}`);
      if (miss.length > 0) parts.push(`${miss.length} 条为旧版记录需重新导入`);
      if (bad.length > 0)
        parts.push(`${bad.length} 条失败（${bad.map((f) => `${f.file_name}: ${f.message ?? ""}`).join("；")}）`);
      setNotice(parts.join("；") || null);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleExportDay = useCallback(
    (dayKey: string) => {
      if (records === null) return;
      const hashes = records
        .filter((r) => (r.record_date.trim() || "未知日期") === dayKey)
        .map((r) => r.file_hash);
      void exportTo(hashes);
    },
    [records, exportTo]
  );

  const handleDelete = useCallback(async (fileHash: string) => {
    const confirmed = window.confirm(
      "确认删除该记录的缓存数据？原始文件不受影响，但需重新导入才能再次分析。"
    );
    if (!confirmed) return;
    try {
      await client.purgeCache(fileHash);
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", width: "100%", flex: 1, minHeight: 0, position: "relative" }}
    >
      {notice && (
        <div
          data-testid="import-notice"
          style={{
            margin: "8px 16px 0",
            borderLeft: "3px solid var(--orange)",
            background: "var(--bg2)",
            padding: "6px 10px",
            fontSize: "13px",
            color: "var(--dim)",
            display: "flex",
            justifyContent: "space-between",
            gap: "10px",
            flex: "none",
          }}
        >
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: "transparent", border: "none", color: "var(--dim2)", cursor: "pointer" }}>
            ✕
          </button>
        </div>
      )}

      <LibraryHomeView
        records={records}
        error={error}
        query={query}
        category={category}
        selectedGroup={selectedGroup}
        selected={selected}
        onQueryChange={setQuery}
        onCategoryChange={(cat) => {
          setCategory(cat);
          setSelectedGroup(null);
        }}
        onGroupChange={setSelectedGroup}
        onOpen={(hash) => {
          openDataset(hash).catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err))
          );
        }}
        onDelete={(hash) => void handleDelete(hash)}
        onRetry={() => setReloadTick((t) => t + 1)}
        onPickFiles={() => void handlePickFiles()}
        onToggleSelect={(hash) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(hash)) next.delete(hash);
            else next.add(hash);
            return next;
          })
        }
        onExportOne={(hash) => void exportTo([hash])}
        onExportSelected={() => void exportTo([...selected])}
        onExportDay={handleExportDay}
      />

      {/* 拖入遮罩：覆盖一级栏以下全部区域（一级栏保持可见） */}
      {dragOver && (
        <div
          data-testid="import-dropzone"
          style={{
            position: "fixed",
            top: "var(--topbar-height, 54px)",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 500,
            background: "rgba(21,21,30,0.82)",
            border: "2px dashed var(--red)",
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div className="f1" style={{ fontWeight: 700, fontSize: "18px", letterSpacing: "2px", color: "#fff" }}>
              拖入导入数据
            </div>
            <div style={{ marginTop: "6px", fontSize: "11px", letterSpacing: "2px", color: "rgba(255,255,255,0.75)" }}>
              支持 .XRK / .CSV / .ZIP
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
