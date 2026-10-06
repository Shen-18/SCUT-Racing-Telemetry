import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as client from "../api/client";
import type { ChannelMeta, RecordSummary } from "../api/client";
import { filterRecords, groupRecords, type LibraryCategory } from "./LibraryView";
import { useAppStore } from "../state/appStore";
import { formatDurationShort } from "../utils/time";

const BLUE = "#2A4A98";
const BLUE_DARK = "#173B8F";
const OVERLAY_RESOLUTIONS = [
  { label: "720p · 1280×720", width: 1280, height: 720 },
  { label: "1080p · 1920×1080", width: 1920, height: 1080 },
  { label: "2K · 2560×1440", width: 2560, height: 1440 },
] as const;

export interface OverlaySelectorProps {
  records: RecordSummary[];
  selectedHash: string | null;
  onSelect(fileHash: string): void;
  onContinue(): void;
}

export const OverlaySelector: React.FC<OverlaySelectorProps> = ({
  records,
  selectedHash,
  onSelect,
  onContinue,
}) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<LibraryCategory>("time");
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const filtered = useMemo(() => filterRecords(records, query), [records, query]);
  const groups = useMemo(() => groupRecords(filtered, category), [filtered, category]);
  const visible = useMemo(
    () => (selectedGroup ? groups.find((group) => group.key === selectedGroup)?.records ?? [] : filtered),
    [filtered, groups, selectedGroup],
  );
  const dateGroups = useMemo(() => {
    const buckets = new Map<string, RecordSummary[]>();
    for (const record of visible) {
      const key = record.record_date.trim() || "UNKNOWN DATE";
      const bucket = buckets.get(key);
      if (bucket) bucket.push(record);
      else buckets.set(key, [record]);
    }
    const result = [...buckets.entries()].map(([key, bucket]) => ({
      key,
      records: [...bucket].sort((a, b) => b.source_mtime_unix - a.source_mtime_unix),
    }));
    result.sort((a, b) => Math.max(...b.records.map((record) => record.source_mtime_unix)) - Math.max(...a.records.map((record) => record.source_mtime_unix)));
    return result;
  }, [visible]);
  const selected = records.find((record) => record.file_hash === selectedHash) ?? null;
  const categoryOptions: Array<{ id: LibraryCategory; label: string; en: string }> = [
    { id: "time", label: "按日期", en: "BY DATE" },
    { id: "vehicle", label: "按车辆", en: "BY CAR" },
  ];
  const renderRecord = (record: RecordSummary) => {
    const active = record.file_hash === selectedHash;
    return (
      <div
        key={record.file_hash}
        data-testid="overlay-record"
        tabIndex={0}
        title="双击进入 Overlay 操作台"
        onClick={() => onSelect(record.file_hash)}
        onDoubleClick={onContinue}
        onKeyDown={(event) => { if (event.key === "Enter") onContinue(); }}
        style={{
          display: "grid",
          gridTemplateColumns: "104px minmax(128px, 1.25fr) minmax(132px, 1fr) 88px 92px",
          gap: "0 8px",
          alignItems: "center",
          textAlign: "center",
          margin: "0 16px",
          padding: "9px 8px",
          borderBottom: "1px solid var(--line)",
          cursor: "pointer",
          fontFamily: '"Titillium", "Microsoft YaHei", sans-serif',
          fontSize: "14px",
          background: active ? "rgba(42,74,152,0.16)" : undefined,
          borderLeft: active ? `3px solid ${BLUE}` : "3px solid transparent",
        }}
        className="library-row"
      >
        <span className="tnum" style={{ color: "var(--dim)", whiteSpace: "nowrap" }}>{record.start_time || "—"}</span>
        <span style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{record.racer || "—"}</span>
        <span style={{ color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={record.vehicle}>{record.vehicle || "—"}</span>
        <span className="tnum" style={{ color: "var(--text)" }}>{formatDurationShort(record.duration)}</span>
        <span style={{ color: active ? "#91A9EA" : "var(--dim2)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "10px", letterSpacing: "1px" }}>{active ? "SELECTED" : "SELECT"}</span>
      </div>
    );
  };

  return (
    <main data-testid="overlay-view" style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", color: "var(--text)", display: "flex", flexDirection: "column", fontFamily: '"Titillium", "Microsoft YaHei", sans-serif' }}>
      <header style={{ minHeight: "52px", padding: "8px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: "10px", flex: "none" }}>
        <div style={{ width: "3px", height: "18px", background: BLUE, flex: "none" }} />
        <div style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "13px", letterSpacing: "2px", color: "var(--dim)" }}>选择数据记录</div>
        <span className="tnum" style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', color: "var(--dim2)", fontSize: "11px", letterSpacing: "1px" }}>{filtered.length} 条记录</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: BLUE, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "10px", letterSpacing: "2px" }}>OVERLAY / SELECT SOURCE</span>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 300px" }}>
        <aside style={{ borderRight: "1px solid var(--line)", minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "13px", letterSpacing: "2px", color: "var(--dim)", padding: "12px 14px 8px" }}>
            <span style={{ width: "3px", height: "12px", background: BLUE, display: "inline-block" }} />分类
          </div>
          <div style={{ display: "flex", gap: "6px", padding: "0 14px 10px", flex: "none" }}>
            {categoryOptions.map((option) => {
              const active = category === option.id;
              return <button key={option.id} onClick={() => { setCategory(option.id); setSelectedGroup(null); }} title={option.en} style={{ flex: 1, padding: "6px 0", background: active ? BLUE : "var(--panel)", border: `1px solid ${active ? BLUE : "var(--line)"}`, color: active ? "#fff" : "var(--dim)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "11px", letterSpacing: "1px", cursor: "pointer" }}>{option.label}</button>;
            })}
          </div>
          <div style={{ padding: "0 14px 10px", flex: "none" }}>
            <input data-testid="overlay-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索车手 / 车辆…" style={{ width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: "2px", color: "var(--text)", padding: "5px 8px", fontSize: "11px", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', letterSpacing: "0.5px" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <div data-testid="overlay-group-all" onClick={() => setSelectedGroup(null)} style={{ display: "flex", alignItems: "center", padding: "8px 14px", cursor: "pointer", background: selectedGroup === null ? "var(--bg2)" : "transparent", borderLeft: selectedGroup === null ? `3px solid ${BLUE}` : "3px solid transparent" }}>
              <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "12px", letterSpacing: "1px" }}>全部</span>
              <span className="tnum" style={{ marginLeft: "auto", fontSize: "12px", color: "var(--dim2)", fontWeight: 700 }}>{filtered.length}</span>
            </div>
            {groups.map((group) => {
              const active = group.key === selectedGroup;
              return <div key={group.key} data-testid={`overlay-group-${group.key}`} onClick={() => setSelectedGroup(active ? null : group.key)} style={{ display: "grid", gridTemplateColumns: "minmax(88px, 1fr) 34px", alignItems: "center", columnGap: "8px", padding: "8px 14px", cursor: "pointer", background: active ? "var(--bg2)" : "transparent", borderLeft: active ? `3px solid ${BLUE}` : "3px solid transparent" }}><span style={{ minWidth: 0, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "12px", letterSpacing: "0.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={group.key}>{group.key}</span><span className="tnum" style={{ fontSize: "12px", color: "var(--dim2)", fontWeight: 700, textAlign: "right" }}>{group.records.length}</span></div>;
            })}
          </div>
        </aside>

        <section style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", minHeight: "52px", padding: "8px 16px", borderBottom: "1px solid var(--line)", flex: "none" }}>
            <span style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "13px", letterSpacing: "2px", color: "var(--dim)" }}>数据明细</span>
            <span className="tnum" style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "11px", letterSpacing: "1px", color: "var(--dim2)" }}>{visible.length} 条记录{selectedGroup !== null ? ` · ${selectedGroup}` : ""}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "104px minmax(128px, 1.25fr) minmax(132px, 1fr) 88px 92px", gap: "0 8px", margin: "0 16px", padding: "0 8px", borderBottom: "1px solid var(--line)", alignItems: "center", minHeight: "32px", flex: "none" }}>
            {['开始时间', '车手', '车辆', '时长', '操作'].map((label) => <span key={label} style={{ fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "12px", fontWeight: 700, letterSpacing: "1.5px", color: "var(--dim2)", padding: "6px 0", textAlign: "center", whiteSpace: "nowrap" }}>{label}</span>)}
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {visible.length === 0 ? <div style={{ padding: "32px", textAlign: "center", color: "var(--dim2)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "12px", fontWeight: 700, letterSpacing: "1.5px" }}>没有匹配的记录</div> : selectedGroup === null ? dateGroups.map((group) => <section key={group.key} data-testid={`overlay-date-group-${group.key}`}><div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 16px 0", padding: "5px 8px", background: "var(--bg2)", borderBottom: "1px solid var(--line)", color: "var(--dim)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px" }}><span style={{ width: "3px", height: "12px", background: BLUE }} /><span>{group.key === "UNKNOWN DATE" ? "未知日期" : group.key}</span><span className="tnum" style={{ marginLeft: "auto", color: "var(--dim2)", fontSize: "10px" }}>{group.records.length} 条</span></div>{group.records.map(renderRecord)}</section>) : visible.map(renderRecord)}
          </div>
        </section>

        <aside style={{ borderLeft: "1px solid var(--line)", background: "var(--bg2)", padding: "16px", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ color: BLUE, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "10px", fontWeight: 700, letterSpacing: "1.5px" }}>已选记录</div>
          {selected ? <div style={{ marginTop: "18px" }}><div style={{ fontSize: "22px", fontWeight: 700, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', letterSpacing: "1px" }}>{selected.racer || "—"}</div><div style={{ marginTop: "4px", color: "var(--dim)", fontSize: "13px" }}>{selected.vehicle || "—"}</div><div style={{ marginTop: "18px", display: "grid", gap: "9px", fontSize: "12px" }}><div><span style={{ color: "var(--dim2)" }}>日期</span><strong style={{ float: "right" }}>{selected.record_date || "—"}</strong></div><div><span style={{ color: "var(--dim2)" }}>开始时间</span><strong className="tnum" style={{ float: "right" }}>{selected.start_time || "—"}</strong></div><div><span style={{ color: "var(--dim2)" }}>时长</span><strong className="tnum" style={{ float: "right" }}>{formatDurationShort(selected.duration)}</strong></div><div><span style={{ color: "var(--dim2)" }}>通道</span><strong className="tnum" style={{ float: "right" }}>{selected.channel_count}</strong></div></div></div> : <div style={{ margin: "auto 0", textAlign: "center", color: "var(--dim2)" }}><div style={{ color: BLUE_DARK, fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontSize: "13px", letterSpacing: "1.5px" }}>SELECT A RECORD</div><div style={{ marginTop: "8px", fontSize: "11px" }}>请先选择一条遥测记录</div></div>}
          <button disabled={!selected} onClick={onContinue} style={{ marginTop: "auto", width: "100%", padding: "9px 12px", background: selected ? BLUE : "var(--panel)", border: `1px solid ${selected ? BLUE : "var(--line)"}`, color: selected ? "#fff" : "var(--dim2)", fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif', fontWeight: 700, fontSize: "11px", letterSpacing: "1px", cursor: selected ? "pointer" : "default" }}>进入操作台</button>
        </aside>
      </div>
    </main>
  );
};

const NULL_CHANNEL = "（不绑定）";

type OverlayBindingSlot = {
  id: string;
  label: string;
  group: string;
  candidates: string[];
};

const OVERLAY_BIND_SLOTS: OverlayBindingSlot[] = [
  { id: "speed", label: "车速 km/h", group: "速度", candidates: ["VehSpd"] },
  { id: "throttle", label: "油门开度 %", group: "踏板", candidates: ["Acc-2", "Acc2"] },
  { id: "brake", label: "刹车 %", group: "踏板", candidates: ["Ave Brake"] },
  { id: "acc_x", label: "加速度 X（纵向）", group: "G 力", candidates: ["ACC X", "a-x"] },
  { id: "acc_y", label: "加速度 Y（侧向）", group: "G 力", candidates: ["ACC Y", "a-y"] },
  { id: "latitude", label: "GPS 纬度", group: "GPS 轨迹", candidates: ["GPS Latitude"] },
  { id: "longitude", label: "GPS 经度", group: "GPS 轨迹", candidates: ["GPS Longitude"] },
  { id: "steer", label: "转向角度 °", group: "转向", candidates: ["Steer Sense", "Ave Steer"] },
  { id: "battery_soc", label: "电池 SOC %", group: "电池", candidates: ["Battery Soc"] },
  { id: "battery_volt", label: "电池电压 V", group: "电池", candidates: ["Battery Volt", "Bat Voltage"] },
  { id: "battery_current", label: "电池电流 A", group: "电池", candidates: ["Battery Current", "current"] },
  { id: "motor_FL_torque", label: "FL 扭矩 Nm", group: "电机 FL", candidates: ["FL Motor Torque", "FL Torque"] },
  { id: "motor_FR_torque", label: "FR 扭矩 Nm", group: "电机 FR", candidates: ["FR Motor Torque", "FR Torque"] },
  { id: "motor_RL_torque", label: "RL 扭矩 Nm", group: "电机 RL", candidates: ["L Motor Torque", "RL Motor Torque", "RL Torque"] },
  { id: "motor_RR_torque", label: "RR 扭矩 Nm", group: "电机 RR", candidates: ["R Motor Torque", "RR Motor Torque", "RR Torque"] },
];

const OVERLAY_BIND_GROUPS = OVERLAY_BIND_SLOTS.reduce<Array<[string, OverlayBindingSlot[]]>>((groups, slot) => {
  const current = groups[groups.length - 1];
  if (!current || current[0] !== slot.group) groups.push([slot.group, [slot]]);
  else current[1].push(slot);
  return groups;
}, []);

const SLOT_COLORS = { auto: "#6ee7b7", miss: "#f85149", manual: "#c9d1d9", null: "#d29922" } as const;
type SlotState = keyof typeof SLOT_COLORS;

type BindingMap = Record<string, string>;

function normalizeChannelName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\\s_-]+/g, "");
}

function autoMatchSlot(slot: OverlayBindingSlot, channels: ChannelMeta[]): string {
  for (const candidate of slot.candidates) {
    const exact = channels.find((channel) => normalizeChannelName(channel.key) === normalizeChannelName(candidate) || normalizeChannelName(channel.name) === normalizeChannelName(candidate));
    if (exact) return exact.key;
  }
  for (const candidate of slot.candidates) {
    const needle = normalizeChannelName(candidate);
    const fuzzy = channels.find((channel) => normalizeChannelName(channel.key).includes(needle) || normalizeChannelName(channel.name).includes(needle));
    if (fuzzy) return fuzzy.key;
  }
  return "";
}

function readOverlayBindings(fileHash: string): BindingMap {
  if (typeof window === "undefined" || !fileHash) return {};
  try {
    const raw = window.localStorage.getItem(`scut.overlay.bindings.${fileHash}`);
    const parsed = raw ? JSON.parse(raw) as unknown : {};
    return parsed && typeof parsed === "object" ? parsed as BindingMap : {};
  } catch {
    return {};
  }
}

function groupLabel(group: string): string {
  return group.toUpperCase();
}

export interface OverlayBindingPanelProps {
  fileHash: string;
  channels: ChannelMeta[];
  onBindingsChange?(bindings: BindingMap): void;
}

export const OverlayBindingPanel: React.FC<OverlayBindingPanelProps> = ({ fileHash, channels, onBindingsChange }) => {
  const channelSignature = channels.map((channel) => `${channel.key}:${channel.name}`).join("\\0");
  const [bindings, setBindings] = useState<BindingMap>({});
  const [autoBindings, setAutoBindings] = useState<BindingMap>({});
  const [savedBindings, setSavedBindings] = useState<BindingMap>({});

  useEffect(() => {
    const automatic = Object.fromEntries(OVERLAY_BIND_SLOTS.map((slot) => [slot.id, autoMatchSlot(slot, channels)]));
    const saved = readOverlayBindings(fileHash);
    const available = new Set(channels.map((channel) => channel.key));
    const restored = Object.fromEntries(OVERLAY_BIND_SLOTS.map((slot) => [slot.id, saved[slot.id] && available.has(saved[slot.id]) ? saved[slot.id] : automatic[slot.id] ?? ""]));
    setAutoBindings(automatic);
    setSavedBindings(saved);
    setBindings(restored);
  }, [fileHash, channelSignature]); // channelSignature keeps this stable while metadata object identities change.

  useEffect(() => {
    onBindingsChange?.(bindings);
    if (!fileHash || typeof window === "undefined") return;
    try { window.localStorage.setItem(`scut.overlay.bindings.${fileHash}`, JSON.stringify(bindings)); } catch { /* storage is optional */ }
  }, [bindings, fileHash, onBindingsChange]);

  const matched = Object.values(bindings).filter(Boolean).length;
  const autoMatched = Object.values(autoBindings).filter(Boolean).length;

  return (
    <aside data-testid="overlay-bindings" style={{ borderRight: "1px solid var(--line)", minHeight: 0, overflowY: "auto", background: "var(--bg2)", padding: "14px 12px", color: "var(--text)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: '"F1 Display", sans-serif', fontWeight: 700, fontSize: "12px", letterSpacing: "1.8px", color: "var(--dim)" }}>
        <span style={{ width: "3px", height: "12px", background: BLUE }} />CHANNEL BINDINGS
      </div>
      <div style={{ margin: "9px 2px 12px", color: "var(--dim2)", fontSize: "11px", lineHeight: 1.45 }}>
        已自动匹配 {autoMatched}/{OVERLAY_BIND_SLOTS.length} 个槽位；当前绑定 {matched} 个。红色槽位需要手动选择。
      </div>
      {OVERLAY_BIND_GROUPS.map(([group, slots]) => (
        <section key={group} style={{ border: "1px solid var(--line)", background: "var(--panel)", marginBottom: "9px", padding: "8px 9px 9px" }}>
          <div style={{ color: BLUE, fontFamily: '"F1 Display", sans-serif', fontWeight: 700, fontSize: "10px", letterSpacing: "1.3px", marginBottom: "7px" }}>{groupLabel(group)}</div>
          <div style={{ display: "grid", gap: "6px" }}>
            {slots.map((slot) => {
              const value = bindings[slot.id] ?? "";
              const state: SlotState = value === "" ? (autoBindings[slot.id] ? "miss" : "null") : value === autoBindings[slot.id] ? "auto" : "manual";
              return (
                <label key={slot.id} htmlFor={`overlay-binding-${slot.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 112px", gap: "7px", alignItems: "center", color: SLOT_COLORS[state], fontSize: "11px" }}>
                  <span title={slot.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.label}</span>
                  <select id={`overlay-binding-${slot.id}`} data-testid={`overlay-binding-${slot.id}`} value={value} disabled={channels.length === 0} onChange={(event) => setBindings((previous) => ({ ...previous, [slot.id]: event.target.value }))} style={{ width: "100%", minWidth: 0, padding: "4px 4px", border: `1px solid ${state === "miss" ? "#f85149" : "var(--line)"}`, background: "var(--bg)", color: "var(--text)", fontSize: "10px" }}>
                    <option value="">{NULL_CHANNEL}</option>
                    {channels.map((channel) => <option key={channel.key} value={channel.key}>{channel.name || channel.key}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </section>
      ))}
      {savedBindings && Object.keys(savedBindings).length > 0 && <div style={{ color: "var(--dim2)", fontSize: "10px", padding: "2px 2px 8px" }}>已恢复这条记录上次的手动绑定。</div>}
    </aside>
  );
};

function formatMetricSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export const OverlayView: React.FC = () => {
  const selectedHash = useAppStore((state) => state.overlayRecordHash);
  const step = useAppStore((state) => state.overlayStep);
  const setSelectedHash = useAppStore((state) => state.setOverlayRecord);
  const setStep = useAppStore((state) => state.setOverlayStep);
  const setView = useAppStore((state) => state.setView);
  const openDataset = useAppStore((state) => state.openDataset);
  const dataset = useAppStore((state) => state.dataset);
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState("READY");
  const [isRendering, setIsRendering] = useState(false);
  const [bindingCount, setBindingCount] = useState(0);
  const [bindings, setBindings] = useState<BindingMap>({});
  const [metrics, setMetrics] = useState({ progress: "0 / 0 帧", percent: 0, fps: "— FPS", elapsed: "00:00", eta: "—:—" });
  const [renderJobId, setRenderJobId] = useState<number | null>(null);
  const [outputFile, setOutputFile] = useState<string | null>(null);
  const [renderConfig, setRenderConfig] = useState({ width: 2560, height: 1440, fps: 100, renderFps: 20, head: 5, tail: 5, workers: 8, codec: "qtrle" as "qtrle" | "prores4444" });

  useEffect(() => { client.listRecords("").then(setRecords).catch((err) => setError(err instanceof Error ? err.message : String(err))); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (renderJobId === null) return;
    let timer: number | undefined;
    let disposed = false;
    const poll = async () => {
      try {
        const progress = await client.overlayExportStatus(renderJobId);
        if (disposed) return;
        setMetrics({ progress: `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} 帧`, percent: progress.percent, fps: progress.fps > 0 ? `${progress.fps.toFixed(1)} FPS` : "— FPS", elapsed: formatMetricSeconds(progress.elapsed), eta: progress.eta > 0 ? formatMetricSeconds(progress.eta) : "00:00" });
        if (progress.status === "completed") {
          setStatus("VIDEO READY");
          setOutputFile(progress.outputPath);
          setRenderJobId(null);
          return;
        }
        if (progress.status === "failed" || progress.status === "cancelled") {
          setStatus(progress.status === "cancelled" ? "CANCELLED" : "RENDER FAILED");
          if (progress.error) setError(progress.error);
          setRenderJobId(null);
          return;
        }
        timer = window.setTimeout(() => void poll(), 250);
      } catch (err) {
        if (!disposed) { setStatus("RENDER FAILED"); setError(err instanceof Error ? err.message : String(err)); setRenderJobId(null); }
      }
    };
    void poll();
    return () => { disposed = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [renderJobId]);

  const continueToOperations = async () => {
    if (!selectedHash) return;
    try {
      await openDataset(selectedHash);
      setView("overlay");
      setStep("operations");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const selected = records.find((record) => record.file_hash === selectedHash) ?? null;
  const onBindingsChange = useCallback((nextBindings: BindingMap) => {
    setBindings(nextBindings);
    setBindingCount(Object.values(nextBindings).filter(Boolean).length);
  }, []);

  const chooseOutputDir = async () => {
    try {
      const directory = await client.pickExportFolder();
      if (directory) setOutputDir(directory);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const generatePreview = async () => {
    setError(null);
    setIsRendering(true);
    setStatus("RENDERING PREVIEW…");
    setMetrics((previous) => ({ ...previous, progress: "1 / 1 帧", percent: 0, fps: "— FPS", elapsed: "00:01", eta: "00:00" }));
    try {
      const result = await client.generateOverlayPreview(dataset?.id, bindings, renderConfig.width, renderConfig.height);
      const url = URL.createObjectURL(new Blob([Uint8Array.from(result.bytes)], { type: "image/png" }));
      setPreviewUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return url; });
      setMetrics({ progress: "1 / 1 帧", percent: 100, fps: "1.0 FPS", elapsed: "00:01", eta: "00:00" });
      setStatus("FRAME READY");
    } catch (err) {
      setStatus("RENDER FAILED");
      setError(err instanceof Error ? err.message : String(err));
    } finally { setIsRendering(false); }
  };

  const startVideoExport = async () => {
    if (!dataset?.id || renderJobId !== null) return;
    setError(null);
    try {
      let directory = outputDir;
      if (!directory) {
        directory = await client.pickExportFolder() ?? "";
        if (!directory) return;
        setOutputDir(directory);
      }
      setOutputFile(null);
      setStatus("QUEUED");
      setMetrics({ progress: "0 / 0 帧", percent: 0, fps: "— FPS", elapsed: "00:00", eta: "—:—" });
      const jobId = await client.startOverlayExport({
        datasetId: dataset.id,
        outputDir: directory,
        width: renderConfig.width,
        height: renderConfig.height,
        fps: renderConfig.fps,
        renderFps: renderConfig.renderFps,
        timelineFps: 100,
        outputStart: 0,
        duration: null,
        paddingHeadSeconds: renderConfig.head,
        paddingTailSeconds: renderConfig.tail,
        offsetSeconds: 0,
        anchors: [],
        bindings,
        maxGapSeconds: 0.5,
        codec: renderConfig.codec,
        workers: renderConfig.workers,
      });
      setRenderJobId(jobId);
    } catch (err) { setStatus("RENDER FAILED"); setError(err instanceof Error ? err.message : String(err)); }
  };

  const cancelVideoExport = async () => {
    if (renderJobId === null) return;
    try { await client.cancelOverlayExport(renderJobId); setStatus("CANCELLING"); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  const openOutputFolder = async () => {
    if (!outputDir) return;
    try { await client.openOverlayFolder(outputDir); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  };

  if (step === "select") return <OverlaySelector records={records} selectedHash={selectedHash} onSelect={setSelectedHash} onContinue={() => void continueToOperations()} />;

  const meta = dataset?.meta;
  const duration = selected?.duration ?? meta?.duration ?? 0;
  const totalFrames = Math.max(0, Math.round((duration + renderConfig.head + renderConfig.tail) * renderConfig.fps));
  const busy = isRendering || renderJobId !== null;

  return (
    <main data-testid="overlay-workbench" style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", color: "var(--text)", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "13px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: "14px", flex: "none" }}>
        <div style={{ minWidth: 0 }}><div style={{ color: BLUE, fontFamily: '"F1 Display", sans-serif', fontWeight: 700, fontSize: "10px", letterSpacing: "2px" }}>OVERLAY / WORKBENCH</div><div style={{ marginTop: "4px", fontSize: "15px", fontWeight: 700 }}>{selected?.file_name ?? meta?.file_path?.split(/[\\/]/).pop() ?? "已选择记录"}</div></div>
        <span style={{ color: "var(--dim)", fontSize: "12px", whiteSpace: "nowrap" }}>{selected?.racer || meta?.racer || "—"} · {selected?.vehicle || meta?.vehicle || "—"} · {selected?.record_date || meta?.date || "—"}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--dim2)", fontSize: "11px" }}>{bindingCount} BINDINGS</span>
        <button onClick={() => setStep("select")} style={{ padding: "7px 12px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", cursor: "pointer" }}>更换记录</button>
        <button data-testid="overlay-render" disabled={busy || !dataset} onClick={() => void startVideoExport()} style={{ padding: "8px 14px", background: busy || !dataset ? "var(--panel)" : BLUE, border: `1px solid ${busy || !dataset ? "var(--line)" : BLUE}`, color: busy || !dataset ? "var(--dim2)" : "#fff", fontFamily: '"F1 Display", sans-serif', fontWeight: 700, letterSpacing: "1px", cursor: busy || !dataset ? "default" : "pointer" }}>开始 Overlay 渲染</button>
      </header>
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "320px minmax(0,1fr) 260px" }}>
        <OverlayBindingPanel fileHash={selectedHash ?? dataset?.file_hash ?? ""} channels={dataset?.channels ?? []} onBindingsChange={onBindingsChange} />
        <section style={{ minWidth: 0, minHeight: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--dim)", fontFamily: '"F1 Display", sans-serif', fontSize: "10px", letterSpacing: "1.5px" }}><span style={{ width: "3px", height: "12px", background: BLUE }} />OVERLAY WORKBENCH<span style={{ marginLeft: "auto", color: status.includes("FAILED") ? "var(--red)" : status === "FRAME READY" ? "#6ee7b7" : "var(--dim2)" }}>{status}</span></div>
          <div data-testid="overlay-progress" style={{ border: `1px solid ${busy ? BLUE : "var(--line)"}`, background: "var(--panel)", padding: "12px 14px", boxShadow: busy ? `0 0 0 1px ${BLUE}22` : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ color: BLUE, fontFamily: '"F1 Display", sans-serif', fontSize: "10px", fontWeight: 700, letterSpacing: "1.5px" }}>RENDER PROGRESS</span><span style={{ color: status.includes("FAILED") ? "var(--red)" : status === "VIDEO READY" ? "#6ee7b7" : "var(--dim2)", fontSize: "11px", fontWeight: 700 }}>{status}</span><strong className="tnum" style={{ marginLeft: "auto", color: "var(--text)", fontSize: "15px" }}>{metrics.percent.toFixed(1)}%</strong></div>
            <div style={{ marginTop: "9px", height: "6px", background: "var(--bg)", border: "1px solid var(--line)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(100, metrics.percent))}%`, height: "100%", background: BLUE, transition: "width 180ms ease-out" }} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(3, 1fr)", gap: "10px", marginTop: "10px", alignItems: "end" }}><div><div style={{ color: "var(--dim2)", fontSize: "10px" }}>已处理帧</div><div className="tnum" style={{ marginTop: "3px", color: "var(--text)", fontWeight: 700 }}>{metrics.progress}</div></div><div><div style={{ color: "var(--dim2)", fontSize: "10px" }}>实时速度</div><strong className="tnum">{metrics.fps}</strong></div><div><div style={{ color: "var(--dim2)", fontSize: "10px" }}>已耗时</div><strong className="tnum">{metrics.elapsed}</strong></div><div><div style={{ color: "var(--dim2)", fontSize: "10px" }}>预计剩余</div><strong className="tnum">{metrics.eta}</strong></div></div>
            <button disabled={renderJobId === null} onClick={() => void cancelVideoExport()} style={{ marginTop: "10px", padding: "6px 10px", background: "transparent", border: `1px solid ${renderJobId === null ? "var(--line)" : "var(--red)" }`, color: renderJobId === null ? "var(--dim2)" : "var(--red)", cursor: renderJobId === null ? "default" : "pointer" }}>终止渲染</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px", border: "1px solid var(--line)", background: "var(--panel)", padding: "11px 12px" }}>
            {[['车手姓名', selected?.racer || meta?.racer || "—"], ['车辆型号', selected?.vehicle || meta?.vehicle || "—"], ['记录时长', formatDurationShort(duration)], ['总帧数', totalFrames ? totalFrames.toLocaleString() : "—"], ['输出规格', `${renderConfig.width}×${renderConfig.height} @ ${renderConfig.fps} FPS`], ['透明编码', `${renderConfig.codec === "qtrle" ? "QTRLE" : "ProRes 4444"} / Alpha MOV`]].map(([label, value]) => <div key={label}><div style={{ color: "var(--dim2)", fontSize: "10px" }}>{label}</div><div className="tnum" style={{ marginTop: "3px", color: "var(--text)", fontSize: "12px", fontWeight: 700 }}>{value}</div></div>)}
          </div>
          <div style={{ border: "1px solid var(--line)", background: "var(--panel)", padding: "11px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--dim)", fontSize: "12px", fontWeight: 700 }}><span>画面预览</span><span style={{ color: "var(--dim2)", fontSize: "10px", fontWeight: 400 }}>速度峰值帧 · 按当前通道绑定</span><button onClick={() => void generatePreview()} disabled={busy} style={{ marginLeft: "auto", padding: "5px 9px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", fontSize: "10px", cursor: isRendering ? "default" : "pointer" }}>更新预览</button></div>
            <div data-testid="overlay-preview" style={{ marginTop: "9px", minHeight: "250px", display: "grid", placeItems: "center", background: "#15181d", backgroundImage: "linear-gradient(45deg,#20242b 25%,transparent 25%),linear-gradient(-45deg,#20242b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#20242b 75%),linear-gradient(-45deg,transparent 75%,#20242b 75%)", backgroundSize: "24px 24px", backgroundPosition: "0 0,0 12px,12px -12px,-12px 0" }}>
              {previewUrl ? <img src={previewUrl} alt="Overlay preview" style={{ maxWidth: "100%", maxHeight: "360px", width: "100%", objectFit: "contain" }} /> : <div style={{ textAlign: "center", color: "var(--dim2)" }}><div style={{ color: BLUE, fontFamily: '"F1 Display", sans-serif', fontSize: "14px", letterSpacing: "2px" }}>OVERLAY PREVIEW</div><div style={{ marginTop: "7px", fontSize: "11px" }}>完成通道绑定后点击“更新预览”</div></div>}
            </div>
            <div style={{ marginTop: "8px", height: "62px", overflow: "hidden", background: "#0d1117", border: "1px solid var(--line)" }}>{previewUrl ? <img src={previewUrl} alt="Overlay bottom strip preview" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "bottom" }} /> : <div style={{ color: "var(--dim2)", fontSize: "10px", textAlign: "center", paddingTop: "22px" }}>底栏预览</div>}</div>
          </div>
          {error && <div style={{ borderLeft: "3px solid var(--red)", paddingLeft: "9px", color: "var(--red)", fontSize: "11px" }}>{error}</div>}
        </section>
        <aside style={{ borderLeft: "1px solid var(--line)", padding: "14px", background: "var(--bg2)", fontSize: "11px", overflowY: "auto" }}>
          <div style={{ color: BLUE, fontFamily: '"F1 Display", sans-serif', fontWeight: 700, fontSize: "10px", letterSpacing: "1.5px" }}>OUTPUT CONFIG</div>
          <div style={{ marginTop: "14px", display: "grid", gap: "8px" }}>
            <label style={{ color: "var(--dim2)" }}>画布尺寸<select aria-label="画布尺寸" value={`${renderConfig.width}x${renderConfig.height}`} onChange={(event) => { const [width, height] = event.target.value.split("x").map(Number); setRenderConfig((previous) => ({ ...previous, width, height })); }} style={{ width: "100%", marginTop: "4px", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "4px", fontSize: "10px" }}>{OVERLAY_RESOLUTIONS.map((resolution) => <option key={resolution.label} value={`${resolution.width}x${resolution.height}`}>{resolution.label}</option>)}</select></label>
            <label style={{ color: "var(--dim2)" }}>输出帧率<select aria-label="输出帧率" value={renderConfig.fps} onChange={(event) => setRenderConfig((previous) => ({ ...previous, fps: Number(event.target.value) }))} style={{ width: "100%", marginTop: "4px", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "4px", fontSize: "10px" }}><option value="100">100 FPS</option><option value="60">60 FPS</option><option value="30">30 FPS</option></select></label>
            <label style={{ color: "var(--dim2)" }}>渲染采样<select aria-label="渲染采样帧率" value={renderConfig.renderFps} onChange={(event) => setRenderConfig((previous) => ({ ...previous, renderFps: Number(event.target.value) }))} style={{ width: "100%", marginTop: "4px", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "4px", fontSize: "10px" }}><option value="20">20 FPS</option><option value="10">10 FPS</option><option value="30">30 FPS</option></select></label>
            <label style={{ color: "var(--dim2)" }}>并行进程<input aria-label="并行进程数" type="number" min="1" max="32" step="1" value={renderConfig.workers} onChange={(event) => setRenderConfig((previous) => ({ ...previous, workers: Number(event.target.value) }))} style={{ width: "100%", boxSizing: "border-box", marginTop: "4px", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "4px", fontSize: "10px" }} /></label>
            <label style={{ color: "var(--dim2)" }}>透明编码<select aria-label="透明编码" value={renderConfig.codec} onChange={(event) => setRenderConfig((previous) => ({ ...previous, codec: event.target.value as "qtrle" | "prores4444" }))} style={{ width: "100%", marginTop: "4px", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "4px", fontSize: "10px" }}><option value="qtrle">QTRLE / ARGB</option><option value="prores4444">ProRes 4444</option></select></label>
            <div><span style={{ color: "var(--dim2)" }}>绑定通道</span><strong style={{ float: "right" }}>{bindingCount}</strong></div>
          </div>
          <div style={{ marginTop: "18px", paddingTop: "12px", borderTop: "1px solid var(--line)" }}><div style={{ color: "var(--dim2)", marginBottom: "6px" }}>输出目录</div><div style={{ display: "flex", gap: "5px" }}><input aria-label="输出目录" value={outputDir} onChange={(event) => setOutputDir(event.target.value)} placeholder="选择导出目录" style={{ minWidth: 0, width: "100%", background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", padding: "5px 6px", fontSize: "10px" }} /><button onClick={() => void chooseOutputDir()} style={{ flex: "none", padding: "4px 6px", background: "transparent", border: "1px solid var(--line)", color: "var(--text)", fontSize: "10px", cursor: "pointer" }}>更改</button></div><div title={outputFile ?? (outputDir || undefined)} style={{ marginTop: "6px", color: outputDir ? "var(--text)" : "var(--dim2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{outputFile ?? (outputDir ? `${outputDir}\\dashboard_${renderConfig.fps === 100 ? "100fps_" : ""}alpha.mov` : "生成时选择目录")}</div>{outputDir && <button onClick={() => void openOutputFolder()} style={{ marginTop: "7px", padding: "4px 7px", background: "transparent", border: "1px solid var(--line)", color: "var(--dim)", fontSize: "10px", cursor: "pointer" }}>打开输出目录</button>}</div>
        </aside>
      </div>
    </main>
  );
};
