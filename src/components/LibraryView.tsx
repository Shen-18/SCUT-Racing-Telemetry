import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as client from "../api/client";
import { listRemoteDateNotes, normalizeRemoteBaseUrl, syncDatasetIndex } from "../api/remote";
import type { RecordSummary } from "../api/client";
import { LEFT_WIDTH_RANGE, useAppStore } from "../state/appStore";
import { ColumnSplitter } from "./ColumnSplitter";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { formatDateTime, formatDurationShort } from "../utils/time";

// 资料库主页（2026-09-16 负责人重构）：
// 一级栏（AppShell 红栏）之下是分类 + 数据详情双栏；
// 左侧 = 分类切换（按日期/按赛车）+ 分组统计列表（组名 + 条数，点击过滤）；
// 右侧 = 选中分组的记录明细（开始时间/备注/车手/车辆/时长/操作）；赛道字段后续补充。
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
      ? r.record_date.trim() || "UNKNOWN DATE"
      : r.vehicle.trim() || "UNKNOWN CAR";
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
  fontSize: "13px",
  letterSpacing: "2px",
  color: "var(--dim)",
  padding: "12px 14px 8px",
  flex: "none",
};

// 备注独立占一列，操作列保留足够空间显示下载和删除。
const GRID_COLUMNS = "28px 104px minmax(128px, 1.25fr) minmax(132px, 1fr) 120px 88px 132px";

function notePreview(note: string, maxLength = 72): string {
  const compact = note.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
}

// 表头与数据行必须共用同一套网格几何：同样的 margin(16px)+水平 padding(8px),
// 单元格自身不再加横向补差 padding —— 否则两套网格原点差 8px,
// 按轨道居中的列(选择框/ACTIONS)会和表头错开。
// 全表列内容统一居中对齐(负责人要求)。
function headerCellStyle(): React.CSSProperties {
  return {
    fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "1.5px",
    color: "var(--dim2)",
    padding: "6px 0",
    textAlign: "center",
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
  onUseForOverlay?(fileHash: string): void;
  onDelete(fileHash: string): void;
  onRetry(): void;
  onPickFiles(): void;
  onSyncIndex?(): void;
  syncingIndex?: boolean;
  onToggleSelect(fileHash: string): void;
  onToggleSelectAll?(hashes: string[], select: boolean): void;
  onDeleteSelected?(): void;
  onReveal?(fileHash: string): void;
  onDeleteDay?(dayKey: string): void;
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
  onUseForOverlay,
  onDelete,
  onRetry,
  onPickFiles,
  onSyncIndex,
  syncingIndex,
  onToggleSelect,
  onToggleSelectAll,
  onDeleteSelected,
  onReveal,
  onDeleteDay,
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

  const allSelected = useMemo(
    () => Boolean(visible && visible.length > 0 && visible.every((r) => selected.has(r.file_hash))),
    [visible, selected]
  );

  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleSelectAllToggle = () => {
    if (!visible || visible.length === 0) return;
    const hashes = visible.map((r) => r.file_hash);
    onToggleSelectAll?.(hashes, !allSelected);
  };

  const categories: Array<{ id: LibraryCategory; label: string; en: string }> = [
    { id: "time", label: "按日期", en: "BY DATE" },
    { id: "vehicle", label: "按车辆", en: "BY CAR" },
  ];

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", flex: 1, minHeight: 0, color: "var(--text)" }}>
      {/* 左侧：分类 + 分组统计列表 */}
      <aside
        data-testid="library-categories"
        style={{
          width: `${categoryWidth}px`,
          height: "100%",
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
                  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                  fontWeight: 700,
                  fontSize: "11px",
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
            <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "12px", letterSpacing: "1px" }}>全部</span>
            <span className="tnum" style={{ marginLeft: "auto", fontSize: "12px", color: "var(--dim2)", fontWeight: 700 }}>
              {total}
            </span>
          </div>
          {groups.map((group) => {
            const active = group.key === selectedGroup;
            const dateNote = group.records.find((record) => record.date_note?.trim())?.date_note?.trim() ?? "";
            // 日期分组右键：导出/删除该日记录（负责人 2026-09-28 指定，替代 EXPORT DAY 按钮）
            const groupMenu =
              category === "time"
                ? (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        { key: "export-day", label: "导出该日记录", onSelect: () => onExportDay(group.key) },
                        { key: "delete-day", label: "删除该日记录", danger: true, onSelect: () => onDeleteDay?.(group.key) },
                      ],
                    });
                  }
                : undefined;
            return (
              <div
                key={group.key}
                data-testid={`group-${group.key}`}
                onClick={() => onGroupChange(active ? null : group.key)}
                onContextMenu={groupMenu}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(88px, 1fr) minmax(0, 1.5fr) 34px",
                  alignItems: "center",
                  columnGap: "8px",
                  padding: "8px 14px",
                  cursor: "pointer",
                  background: active ? "var(--bg2)" : "transparent",
                  borderLeft: active ? "3px solid var(--red)" : "3px solid transparent",
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                    fontWeight: 700,
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={group.key}
                >
                  {group.key}
                </span>
                <span
                  title={dateNote || undefined}
                  style={{
                    minWidth: 0,
                    color: "var(--dim)",
                    fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                    paddingLeft: "8px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {category === "time" && dateNote ? notePreview(dateNote) : ""}
                </span>
                <span className="tnum" style={{ fontSize: "12px", color: "var(--dim2)", fontWeight: 700, textAlign: "right" }}>
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

      {/* 右侧：记录明细（空白处右键 = 页面菜单：导入/全选/刷新） */}
      <section
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { key: "import", label: "导入", onSelect: () => onPickFiles() },
              {
                key: "select-all",
                label: "全选",
                disabled: !visible || visible.length === 0,
                onSelect: () => onToggleSelectAll?.(visible!.map((r) => r.file_hash), true),
              },
              { key: "refresh", label: "刷新", onSelect: () => onRetry() },
            ],
          });
        }}
        style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}
      >
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
          <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "13px", letterSpacing: "2px", color: "var(--dim)" }}>
            数据明细
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
                padding: "5px 8px",
                fontSize: "11px",
                fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                letterSpacing: "0.5px",
              }}
            />
          )}
          {records !== null && (
            <span className="tnum" style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "11px", letterSpacing: "1px", color: "var(--dim2)" }}>
              {total} 条记录{selectedGroup !== null ? ` · ${selectedGroup}` : ""}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {selected.size > 0 && (
            <span data-testid="bulk-bar" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className="tnum" style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "11px", fontWeight: 700, color: "var(--red)", letterSpacing: "1px" }}>
                已选 {selected.size} 条
              </span>
              <button
                data-testid="export-selected"
                onClick={onExportSelected}
                className="primary-button"
                style={{
                  background: "var(--red)",
                  border: "1px solid var(--red)",
                  color: "#fff",
                  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                  fontWeight: 700,
                  fontSize: "11px",
                  letterSpacing: "1px",
                  padding: "5px 12px",
                  cursor: "pointer",
                }}
              >
                导出所选
              </button>
              <button
                data-testid="delete-selected"
                onClick={onDeleteSelected}
                className="ghost-button"
                style={{
                  background: "transparent",
                  border: "1px solid var(--line)",
                  color: "var(--dim2)",
                  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                  fontWeight: 700,
                  fontSize: "10px",
                  letterSpacing: "1px",
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
                title="删除所选记录的缓存数据(原始文件不受影响)"
              >
                删除所选
              </button>
            </span>
          )}
          {onSyncIndex && (
            <button
              data-testid="sync-index"
              onClick={onSyncIndex}
              className="ghost-button"
              disabled={syncingIndex}
              style={{
                background: "transparent",
                border: "1px solid var(--line)",
                color: syncingIndex ? "var(--dim2)" : "var(--text)",
                fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
                fontWeight: 700,
                fontSize: "11px",
                letterSpacing: "1px",
                padding: "5px 12px",
                cursor: syncingIndex ? "default" : "pointer",
                whiteSpace: "nowrap",
              }}
              title="把本地记录索引同步到云端服务器"
            >
              {syncingIndex ? "同步中…" : "同步索引"}
            </button>
          )}
          <button
            data-testid="pick-files"
            onClick={onPickFiles}
            className="primary-button"
            style={{
              background: "var(--red)",
              border: "1px solid var(--red)",
              color: "#fff",
              fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "1.5px",
              padding: "6px 14px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            title="导入 xrk / xrz / csv / zip 文件"
          >
            导入文件
          </button>
        </div>
        {error ? (
          <div style={{ margin: "16px", borderLeft: "3px solid var(--red)", background: "var(--bg2)", padding: "10px 14px", fontSize: "13px" }}>
            <div>{error}</div>
            <button
              onClick={onRetry}
              className="ghost-button"
              style={{ marginTop: "8px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "11px", letterSpacing: "1px", padding: "4px 12px", cursor: "pointer" }}
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
              <span style={{ transform: "skewX(10deg)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, color: "#fff", fontSize: "16px" }}>
                DB
              </span>
            </div>
            <div style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "14px", letterSpacing: "1.5px" }}>导入遥测数据以开始分析</div>
            <div style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 400, fontSize: "11px", letterSpacing: "1px", marginTop: "6px" }}>
              点击「导入文件」或将文件拖入本窗口
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLUMNS,
                gap: "0 8px",
                margin: "0 16px",
                padding: "0 8px",
                borderBottom: "1px solid var(--line)",
                alignItems: "center",
                minHeight: "32px",
                flex: "none",
              }}
            >
              <span
                data-testid="select-all-header-box"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectAllToggle();
                }}
                style={{
                  width: "14px",
                  height: "14px",
                  border: `1.5px solid ${allSelected ? "var(--text)" : selected.size > 0 ? "var(--red)" : "var(--dim2)"}`,
                  flex: "none",
                  position: "relative",
                  display: "inline-block",
                  cursor: "pointer",
                  justifySelf: "center",
                }}
                title={allSelected ? "DESELECT ALL" : "SELECT ALL"}
              >
                {allSelected && (
                  <span style={{ position: "absolute", inset: "2px", background: "var(--text)" }} />
                )}
                {!allSelected && selected.size > 0 && (
                  <span style={{ position: "absolute", left: "2px", right: "2px", top: "4px", height: "2px", background: "var(--red)" }} />
                )}
              </span>
              <span style={headerCellStyle()}>开始时间</span>
              <span style={headerCellStyle()}>备注</span>
              <span style={headerCellStyle()}>车手</span>
              <span style={headerCellStyle()}>车辆</span>
              <span style={headerCellStyle()}>时长</span>
              <span style={headerCellStyle()}>操作</span>
            </div>

            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {visible!.length === 0 ? (
                <div style={{ padding: "32px", textAlign: "center", color: "var(--dim2)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "12px", fontWeight: 700, letterSpacing: "1.5px" }}>
                  没有匹配的记录
                </div>
              ) : (
                visible!.map((record) => {
                  return (
                    <div
                      key={record.file_hash}
                      data-testid="library-row"
                      tabIndex={0}
                      title="双击打开分析"
                      onDoubleClick={() => onOpen(record.file_hash)}
                      onKeyDown={(e) => e.key === "Enter" && onOpen(record.file_hash)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const hash = record.file_hash;
                        setMenu({
                          x: e.clientX,
                          y: e.clientY,
                          items: [
                            ...(onUseForOverlay
                              ? [{ key: "overlay", label: "用于 Overlay", onSelect: () => onUseForOverlay(hash) }]
                              : []),
                            { key: "reveal", label: "打开文件目录", onSelect: () => onReveal?.(hash) },
                            { key: "export", label: "导出此记录", onSelect: () => onExportOne(hash) },
                            { key: "delete", label: "删除此记录", danger: true, onSelect: () => onDelete(hash) },
                            {
                              key: "toggle-select",
                              label: selected.has(hash) ? "取消勾选" : "勾选",
                              onSelect: () => onToggleSelect(hash),
                            },
                          ],
                        });
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: GRID_COLUMNS,
                        gap: "0 8px",
                        alignItems: "center",
                        textAlign: "center",
                        margin: "0 16px",
                        padding: "9px 8px",
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
                          justifySelf: "center",
                        }}
                        title="勾选以导出"
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
                      <span
                        data-testid="record-note"
                        title={record.record_note?.trim() || undefined}
                        style={{
                          minWidth: 0,
                          color: "var(--dim)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          textAlign: "center",
                        }}
                      >
                        {record.record_note?.trim() ? notePreview(record.record_note, 48) : "—"}
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
                      <span style={{ display: "flex", gap: "6px", justifyContent: "center", alignItems: "center" }}>
                        <button
                          aria-label={`Export ${record.file_name}`}
                          title="导出 CSV"
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportOne(record.file_hash);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--dim)",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: "2px 6px",
                          }}
                        >
                          ⬇
                        </button>
                        <button
                          aria-label={`Delete ${record.file_name}`}
                          title="删除该记录的缓存(原始文件不受影响)"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(record.file_hash);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "var(--dim2)",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: "2px 6px",
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

      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
};

export const LibraryView: React.FC = () => {
  const openDataset = useAppStore((s) => s.openDataset);
  const trackImport = useAppStore((s) => s.trackImport);
  const enterOverlay = useAppStore((s) => s.enterOverlay);
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
  const [syncingIndex, setSyncingIndex] = useState(false);
  const lastSyncedCountRef = useRef(0);

  // 全量索引推云端（file_hash 幂等）；未配置云端地址时返回空串
  const runCloudSync = useCallback(async (): Promise<string> => {
    const baseUrl = normalizeRemoteBaseUrl(localStorage.getItem("scut.remote-server-url") || "");
    if (!baseUrl) return "";
    const list = await client.listRecords("");
    const result = await syncDatasetIndex(baseUrl, list);
    lastSyncedCountRef.current = result.synced;
    return result.skipped > 0
      ? `已同步 ${result.synced} 条记录索引到云端（跳过 ${result.skipped} 条日期无法解析的记录）`
      : `已同步 ${result.synced} 条记录索引到云端`;
  }, []);

  // 记录列表出现变化（导入完成、首次加载）时自动同步一次；失败只提示，不影响本地使用
  useEffect(() => {
    if (records === null || records.length === 0 || records.length === lastSyncedCountRef.current) return;
    if (!normalizeRemoteBaseUrl(localStorage.getItem("scut.remote-server-url") || "")) return;
    setSyncingIndex(true);
    runCloudSync()
      .then((message) => setNotice(message))
      .catch((err: unknown) => setNotice(`云端同步失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setSyncingIndex(false));
  }, [records, runCloudSync]);

  const handleSyncIndex = useCallback(() => {
    setSyncingIndex(true);
    runCloudSync()
      .then((message) => setNotice(message || "未配置云端服务器地址（设置 → 云端服务器）"))
      .catch((err: unknown) => setNotice(`云端同步失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setSyncingIndex(false));
  }, [runCloudSync]);

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
      .then(async (list) => {
        let merged = list;
        try {
          const baseUrl = normalizeRemoteBaseUrl(localStorage.getItem("scut.remote-server-url") || "");
          if (baseUrl) {
            const notes = await listRemoteDateNotes(baseUrl);
            const byDate = new Map(notes.map((item) => [item.date_key, item.note]));
            merged = list.map((record) => ({
              ...record,
              date_note: byDate.get(record.record_date.trim()) ?? record.date_note,
            }));
          }
        } catch {
          // 云端不可用时继续显示本地索引，离线分析不受影响。
        }
        if (!cancelled) {
          setRecords(merged);
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
      if (queued.length > 0) parts.push(`已排队导入 ${queued.length} 个文件`);
      if (duplicated.length > 0)
        parts.push(`跳过 ${duplicated.length} 个重复文件(${duplicated.map((d) => d.file_name).join(", ")})`);
      if (failed.length > 0)
        parts.push(`导入失败 ${failed.length} 个文件(${failed.map((f) => `${f.file_name}: ${f.message ?? ""}`).join("; ")})`);
      setNotice(parts.length > 0 ? parts.join("; ") : null);
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
      if (ok.length > 0) parts.push(`已导出 ${ok.length} 条记录到 ${dir}`);
      if (miss.length > 0) parts.push(`${miss.length} 条旧版记录需要重新导入`);
      if (bad.length > 0)
        parts.push(`导出失败 ${bad.length} 个文件(${bad.map((f) => `${f.file_name}: ${f.message ?? ""}`).join("; ")})`);
      setNotice(parts.join("; ") || null);
      setSelected(new Set());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleExportDay = useCallback(
    (dayKey: string) => {
      if (records === null) return;
      const hashes = records
        .filter((r) => (r.record_date.trim() || "UNKNOWN DATE") === dayKey)
        .map((r) => r.file_hash);
      void exportTo(hashes);
    },
    [records, exportTo]
  );

  const handleDelete = useCallback(async (fileHash: string) => {
    const confirmed = window.confirm(
      "确认删除该记录的缓存数据?原始文件不受影响,但需要重新导入才能再次分析。"
    );
    if (!confirmed) return;
    try {
      await client.purgeCache(fileHash);
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // 右键"打开文件目录"：资源管理器定位原始源文件
  const handleReveal = useCallback((fileHash: string) => {
    client.revealRecord(fileHash).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  // 日期分组右键"删除该日记录"
  const handleDeleteDay = useCallback(
    (dayKey: string) => {
      if (records === null) return;
      const hashes = records
        .filter((r) => (r.record_date.trim() || "UNKNOWN DATE") === dayKey)
        .map((r) => r.file_hash);
      if (hashes.length === 0) return;
      const confirmed = window.confirm(
        `确认删除 ${dayKey} 当日 ${hashes.length} 条记录的缓存数据?原始文件不受影响,但需要重新导入才能再次分析。`
      );
      if (!confirmed) return;
      void (async () => {
        try {
          for (const hash of hashes) {
            await client.purgeCache(hash);
          }
          setReloadTick((t) => t + 1);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [records]
  );

  const handleDeleteSelected = useCallback(async () => {
    const hashes = [...selected];
    if (hashes.length === 0) return;
    const confirmed = window.confirm(
      `确认删除所选 ${hashes.length} 条记录的缓存数据?原始文件不受影响,但需要重新导入才能再次分析。`
    );
    if (!confirmed) return;
    try {
      for (const hash of hashes) {
        await client.purgeCache(hash);
      }
      setSelected(new Set());
      setReloadTick((t) => t + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selected]);

  const handleToggleSelectAll = useCallback((hashes: string[], select: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (select) {
        for (const h of hashes) next.add(h);
      } else {
        for (const h of hashes) next.delete(h);
      }
      return next;
    });
  }, []);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", flex: 1, minHeight: 0, position: "relative" }}
    >
      {notice && (
        <div
          data-testid="import-notice"
          style={{
            margin: "8px 16px 0",
            borderLeft: "3px solid var(--orange)",
            background: "var(--bg2)",
            padding: "6px 10px",
            fontSize: "12px",
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
        onUseForOverlay={(hash) => enterOverlay(hash)}
        onDelete={(hash) => void handleDelete(hash)}
        onReveal={handleReveal}
        onDeleteDay={handleDeleteDay}
        onRetry={() => setReloadTick((t) => t + 1)}
        onPickFiles={() => void handlePickFiles()}
        onSyncIndex={handleSyncIndex}
        syncingIndex={syncingIndex}
        onToggleSelect={(hash) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(hash)) next.delete(hash);
            else next.add(hash);
            return next;
          })
        }
        onToggleSelectAll={handleToggleSelectAll}
        onDeleteSelected={() => void handleDeleteSelected()}
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
            top: "var(--topbar-height, 46px)",
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
            <div style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "16px", letterSpacing: "2px", color: "#fff" }}>
              拖入文件以导入
            </div>
            <div style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 400, marginTop: "6px", fontSize: "11px", letterSpacing: "2px", color: "rgba(255,255,255,0.75)" }}>
              支持格式:.XRK / .CSV / .ZIP
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
