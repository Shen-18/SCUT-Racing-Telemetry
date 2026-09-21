import React, { useEffect, useState } from "react";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import { getDatasetDuration, getDatasetFileName } from "../api/dataset";
import { formatDurationShort } from "../utils/time";

// 文件卡片（手册附录 B.4-P1 上半 / DESIGN-SPEC 4.3）
// 文件名 F1 Display 700 13px；chips = RATE/LAPS/SIZE；元数据表右对齐。
// 走查后已删「通道数」「最快圈」两行（状态栏与 chips 已有信息，不重复展示）。

export interface FileNameSegment {
  text: string;
  hot: boolean;
}

// 会话名出现在文件名中的片段高亮为红色（DESIGN-SPEC 2.4 红色边界第 7 条）。
// 关键词过短（<3 字符）或不匹配时不高亮，避免误标。
export function highlightFileName(fileName: string, keyword: string): FileNameSegment[] {
  const needle = keyword.trim();
  if (needle.length < 3) return [{ text: fileName, hot: false }];
  const lowerName = fileName.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const at = lowerName.indexOf(lowerNeedle);
  if (at < 0) return [{ text: fileName, hot: false }];
  return [
    { text: fileName.slice(0, at), hot: false },
    { text: fileName.slice(at, at + needle.length), hot: true },
    { text: fileName.slice(at + needle.length), hot: false },
  ].filter((seg) => seg.text.length > 0);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "—";
  return `${Math.round(rate)}Hz`;
}

const panelTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontFamily: '"F1 Display", "Microsoft YaHei", sans-serif',
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "2px",
  color: "var(--dim)",
  padding: "12px 0 8px",
};

const redBlockStyle: React.CSSProperties = {
  width: "3px",
  height: "12px",
  background: "var(--red)",
  display: "inline-block",
  flex: "none",
};

const chipStyle: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--line)",
  padding: "2px 8px",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--dim)",
};

/** 最短圈时的圈；无圈返回 null。 */
export function pickBestLap(laps: client.LapInfo[]): client.LapInfo | null {
  if (laps.length === 0) return null;
  return laps.reduce((best, lap) => (lap.duration < best.duration ? lap : best), laps[0]);
}

export interface FileCardViewProps {
  dataset: client.DatasetMeta | null;
  laps?: client.LapInfo[] | null;
}

/** 纯展示层：测试直接渲染，不依赖 zustand 初始状态。 */
export const FileCardView: React.FC<FileCardViewProps> = ({ dataset, laps = null }) => {
  if (!dataset) return null;

  const meta = dataset.meta;
  const fileName = getDatasetFileName(dataset);
  const segments = highlightFileName(fileName, meta.session);

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "车手 Driver", value: meta.racer || "—" },
    { label: "赛车 Car", value: meta.vehicle || "—" },
    { label: "时长 Duration", value: formatDurationShort(getDatasetDuration(dataset)) },
  ];

  return (
    <div style={{ padding: "0 14px 12px", borderBottom: "1px solid var(--line)", flex: "none" }}>
      <div style={panelTitleStyle}>
        <span style={redBlockStyle} />
        DATA FILE
      </div>
      <div
        className="f1"
        style={{
          fontWeight: 700,
          fontSize: "13px",
          letterSpacing: "0.5px",
          lineHeight: 1.3,
          wordBreak: "break-all",
          color: "var(--text)",
        }}
        title={meta.file_path}
      >
        {segments.map((seg, i) =>
          seg.hot ? (
            <em key={i} style={{ color: "var(--red)", fontStyle: "normal" }}>
              {seg.text}
            </em>
          ) : (
            <span key={i}>{seg.text}</span>
          )
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" }}>
        <span style={chipStyle}>
          RATE<b style={{ color: "var(--text)", fontWeight: 700, marginLeft: "3px" }}>{formatRate(meta.sample_rate_hz)}</b>
        </span>
        <span style={chipStyle}>
          LAPS<b style={{ color: "var(--text)", fontWeight: 700, marginLeft: "3px" }}>{laps === null ? "—" : laps.length}</b>
        </span>
        <span style={chipStyle}>
          SIZE<b style={{ color: "var(--text)", fontWeight: 700, marginLeft: "3px" }}>{formatFileSize(dataset.file_size ?? 0)}</b>
        </span>
      </div>
      <table style={{ width: "100%", marginTop: "10px", borderCollapse: "collapse", fontSize: "12px" }}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ padding: "3px 0", color: "var(--dim)" }}>{row.label}</td>
              <td
                className="tnum"
                style={{ padding: "3px 0", textAlign: "right", color: "var(--text)", fontWeight: 600 }}
              >
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** 接 store 的容器：拉取圈数据后交给 FileCardView。 */
export const FileCard: React.FC = () => {
  const dataset = useAppStore((s) => s.dataset);
  const [laps, setLaps] = useState<client.LapInfo[] | null>(null);

  useEffect(() => {
    if (!dataset) {
      setLaps(null);
      return;
    }
    let cancelled = false;
    setLaps(null);
    client
      .getLaps(dataset.id)
      .then((list) => {
        if (!cancelled) setLaps(list);
      })
      .catch(() => {
        if (!cancelled) setLaps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  return <FileCardView dataset={dataset} laps={laps} />;
};
