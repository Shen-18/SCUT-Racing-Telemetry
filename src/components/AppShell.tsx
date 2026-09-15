import React, { useEffect, useRef, useState, useCallback } from "react";
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview";
import "dockview/dist/styles/dockview.css";
import { useAppStore } from "../state/appStore";
import { ImportProgressBar } from "./ImportProgressBar";
import { TimelineBar } from "./TimelineBar";
import { PANELS } from "../panels/registry";
import * as client from "../api/client";
import { getDatasetDuration, getDatasetFileName } from "../api/dataset";

export const AppShell: React.FC = () => {
  const dataset = useAppStore((s) => s.dataset);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const window = useAppStore((s) => s.window);
  const generation = useAppStore((s) => s.generation);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const importJobs = useAppStore((s) => s.importJobs);
  const startImport = useAppStore((s) => s.startImport);
  const updateImportStatus = useAppStore((s) => s.updateImportStatus);

  const [inputPath, setInputPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active import job if any
  const latestJob = Object.values(importJobs).at(-1) || null;
  const isJobRunning =
    latestJob !== null &&
    latestJob.stage !== "Ready" &&
    latestJob.stage !== "Failed" &&
    latestJob.stage !== "Cancelled";

  // Poll active import job
  useEffect(() => {
    if (!latestJob || !isJobRunning) return;

    const jobId = latestJob.job_id;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const status = await client.importStatus(jobId);
        updateImportStatus(status);
        if (
          status.stage === "Ready" ||
          status.stage === "Failed" ||
          status.stage === "Cancelled"
        ) {
          setImporting(false);
          return;
        }
        timer = globalThis.setTimeout(poll, 250);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setImporting(false);
      }
    };

    timer = globalThis.setTimeout(poll, 250);
    return () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [latestJob?.job_id, isJobRunning, updateImportStatus]);

  const handleStartImport = async () => {
    const trimmed = inputPath.trim();
    if (!trimmed) return;
    if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed)) {
      setError("请输入绝对路径（如 D:\\Data\\session.xrk 或 /data/session.xrk）");
      return;
    }
    setError(null);
    setImporting(true);
    try {
      await startImport(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setImporting(false);
    }
  };

  const handleCancelImport = async () => {
    if (latestJob) {
      try {
        await client.cancelImport(latestJob.job_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // Build dockview component map from PANELS
  const components = useRef<Record<string, React.FC<IDockviewPanelProps>>>({}).current;
  for (const panel of PANELS) {
    if (!components[panel.id]) {
      const Component = panel.component;
      components[panel.id] = (props: IDockviewPanelProps) => (
        <Component api={props.containerApi} />
      );
    }
  }

  // Initialize Dockview layout on ready
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const api = event.api;

    // 1. Add Center Plot Stack
    api.addPanel({
      id: "plot-stack",
      component: "plot-stack",
      title: "绘图区",
      minimumWidth: 280,
    });

    // 2. Add Left Channel Tree
    api.addPanel({
      id: "channel-tree",
      component: "channel-tree",
      title: "通道列表",
      initialWidth: 260,
      minimumWidth: 180,
      position: { direction: "left", referencePanel: "plot-stack" },
    });

    // 3. Add Right panels: Laps, Stats, Comments, Track Map
    api.addPanel({
      id: "laps",
      component: "laps",
      title: "圈速",
      initialWidth: 300,
      minimumWidth: 220,
      position: { direction: "right", referencePanel: "plot-stack" },
    });

    api.addPanel({
      id: "stats",
      component: "stats",
      title: "统计",
      position: { referencePanel: "laps" },
    });

    api.addPanel({
      id: "comments",
      component: "comments",
      title: "批注",
      position: { referencePanel: "laps" },
    });

    api.addPanel({
      id: "track-map",
      component: "track-map",
      title: "赛道图",
      position: { referencePanel: "laps" },
    });
  }, []);

  const statusColor = isJobRunning
    ? "var(--status-warning)"
    : latestJob?.stage === "Failed"
      ? "var(--status-error)"
      : dataset
        ? "var(--status-ready)"
        : "var(--text-muted)";

  const statusText = isJobRunning
    ? "正在导入…"
    : latestJob?.stage === "Failed"
      ? "导入失败"
      : dataset
        ? "就绪"
        : "就绪 (等待导入)";
  const datasetFileName = getDatasetFileName(dataset);
  const datasetDuration = dataset ? getDatasetDuration(dataset) : null;

  return (
    <div
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-app)",
        color: "var(--text-primary)",
        overflow: "hidden",
      }}
    >
      {/* Topbar: 40px five-part composition (B.2/B.3) */}
      <header
        className="app-shell__topbar"
        style={{
          height: "var(--topbar-height, 40px)",
          minHeight: "var(--topbar-height, 40px)",
          maxHeight: "var(--topbar-height, 40px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: "12px",
          gap: "16px",
          userSelect: "none",
        }}
      >
        {/* Part 1: Brand */}
        <div className="app-shell__brand" style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <div
            style={{
              width: "22px",
              height: "22px",
              background: "var(--accent)",
              borderRadius: "4px",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: "12px",
              color: "#fff",
            }}
          >
            S
          </div>
          <span style={{ fontWeight: 600, fontSize: "13px" }}>SCUT Racing Telemetry</span>
        </div>

        {/* Part 2: Dataset Info */}
        <div
          className="app-shell__dataset"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            color: "var(--text-muted)",
            fontSize: "11px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {dataset ? (
            <>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                {datasetFileName}
              </span>
              <span>时长: {datasetDuration ? `${datasetDuration.toFixed(1)}s` : "—"}</span>
              <span>通道: {dataset.channels.length}</span>
            </>
          ) : (
            <span>未加载数据集</span>
          )}
        </div>

        {/* Part 3: Import control */}
        <div className="app-shell__import" style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, maxWidth: "480px", minWidth: 0 }}>
          <input
            type="text"
            placeholder="输入绝对路径 (如 D:\Data\session.xrk)"
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleStartImport()}
            style={{
              flex: 1,
              minWidth: 0,
              height: "26px",
              background: "var(--bg-app)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-primary)",
              padding: "0 8px",
              fontSize: "11px",
            }}
          />
          <button
            onClick={() => void handleStartImport()}
            disabled={importing || isJobRunning || !inputPath.trim()}
            style={{
              height: "26px",
              padding: "0 12px",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "11px",
              cursor: "pointer",
              opacity: importing || isJobRunning || !inputPath.trim() ? 0.5 : 1,
            }}
          >
            导入
          </button>
        </div>

        {/* Part 4: Theme switcher & Generation counter */}
        <div className="app-shell__tools" style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
          <span
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              fontFamily: "monospace",
              padding: "2px 6px",
              background: "var(--bg-app)",
              borderRadius: "3px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            gen: {generation}
          </span>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              borderRadius: "4px",
              padding: "2px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {theme === "dark" ? "☀ 亮色" : "🌙 深色"}
          </button>
        </div>

        {/* Part 5: Status light and text */}
        <div className="app-shell__status" style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: statusColor,
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{statusText}</span>
        </div>
      </header>

      {/* Progress Bar (B.7): Directly beneath topbar */}
      {latestJob && (isJobRunning || latestJob.stage === "Failed") && (
        <ImportProgressBar status={latestJob} onCancel={handleCancelImport} />
      )}

      {/* Error notification if any */}
      {error && (
        <div
          className="app-shell__error"
          style={{
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--status-error)",
            color: "var(--status-error)",
            padding: "4px 16px",
            fontSize: "11px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main workspace with Dockview */}
      <main className="app-shell__main" style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-abyss"
        />
      </main>

      {/* TimelineBar placeholder */}
      <TimelineBar />

      {/* Bottom Statusbar: 24px vertical dividers (B.2) */}
      <footer
        className="app-shell__statusbar"
        style={{
          height: "var(--statusbar-height, 24px)",
          minHeight: "var(--statusbar-height, 24px)",
          maxHeight: "var(--statusbar-height, 24px)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--bg-panel)",
          borderTop: "1px solid var(--border)",
          fontSize: "11px",
          color: "var(--text-muted)",
          gap: "8px",
          userSelect: "none",
        }}
      >
        <span className="app-shell__status-file">{dataset ? datasetFileName : "无活跃文件"}</span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span>
          通道: {checkedChannels.length} / {dataset?.channels.length || 0}
        </span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span>
          视口: [{window.start.toFixed(2)}s ~ {window.end.toFixed(2)}s]
        </span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span>代际: {generation}</span>
        <span style={{ color: "var(--border)" }}>|</span>
        <span style={{ marginLeft: "auto", color: "var(--status-ready)" }}>
          ● Ready (Step 5 切片)
        </span>
      </footer>
    </div>
  );
};
