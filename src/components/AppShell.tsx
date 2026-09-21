import React, { useEffect, useRef, useState } from "react";
import { useAppStore, isNonTerminalImportStage } from "../state/appStore";
import { ImportProgressBar } from "./ImportProgressBar";
import { TimelineBar } from "./TimelineBar";
import { ColumnSplitter } from "./ColumnSplitter";
import { FileCard } from "./FileCard";
import { LibraryView } from "./LibraryView";
import { PANELS } from "../panels/registry";
import * as client from "../api/client";
import { getDatasetFileName } from "../api/dataset";
import { formatClockTime } from "../utils/time";
import { LEFT_WIDTH_RANGE, RIGHT_WIDTH_RANGE } from "../state/appStore";
import logoUrl from "../assets/logo_white.png";

// 应用壳层（手册附录 B.2 rev.5 / DESIGN-SPEC 9.5）：红色一级栏（logo 白图 + 白字导航，
// 参照 F1 转播栏）+ 固定三栏 Grid（左右栏宽可拖调）+ 24px 状态栏；dockview 已移除（D16）。

const GHOST_BUTTON_STYLE: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "1.5px",
  padding: "7px 16px",
  cursor: "pointer",
};

function GhostButton({
  children,
  onClick,
  disabled,
  title,
  testId,
  onRed,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
  /** 红底一级栏上的变体：白描边白字（F1 转播栏按钮）。 */
  onRed?: boolean;
}) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="ghost-button"
      style={
        onRed
          ? {
              ...GHOST_BUTTON_STYLE,
              borderColor: "rgba(255,255,255,0.45)",
              color: disabled ? "rgba(255,255,255,0.4)" : "#FFFFFF",
            }
          : GHOST_BUTTON_STYLE
      }
    >
      {children}
    </button>
  );
}

export interface AppShellProps {
  /** 测试缝隙：SSR 渲染下 zustand 恒返回初始状态，用覆盖值验证另一视图 */
  viewOverride?: "library" | "analysis";
}

export const AppShell: React.FC<AppShellProps> = ({ viewOverride }) => {
  const dataset = useAppStore((s) => s.dataset);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const window = useAppStore((s) => s.window);
  const cursorT = useAppStore((s) => s.cursorT);
  const setCursor = useAppStore((s) => s.setCursor);
  const generation = useAppStore((s) => s.generation);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const importJobs = useAppStore((s) => s.importJobs);
  const updateImportStatus = useAppStore((s) => s.updateImportStatus);
  const leftWidth = useAppStore((s) => s.leftWidth);
  const rightWidth = useAppStore((s) => s.rightWidth);
  const setLeftWidth = useAppStore((s) => s.setLeftWidth);
  const setRightWidth = useAppStore((s) => s.setRightWidth);
  const storeView = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const playing = useAppStore((s) => s.playing);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const view = viewOverride ?? storeView;

  const [error, setError] = useState<string | null>(null);

  const panelById = useRef<Record<string, React.FC>>({}).current;
  for (const panel of PANELS) {
    if (!panelById[panel.id]) {
      panelById[panel.id] = panel.component;
    }
  }
  const ChannelTreePanel = panelById["channel-tree"];
  const PlotStackPanel = panelById["plot-stack"];
  const TrackMapPanelComponent = panelById["track-map"];
  const StatsPanelComponent = panelById["stats"];
  const CommentsPanelComponent = panelById["comments"];

  // Active import job if any
  const latestJob = Object.values(importJobs).at(-1) || null;
  const isJobRunning = latestJob !== null && isNonTerminalImportStage(latestJob.stage);

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
          return;
        }
        timer = globalThis.setTimeout(poll, 250);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    timer = globalThis.setTimeout(poll, 250);
    return () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
    };
  }, [latestJob?.job_id, isJobRunning, updateImportStatus]);

  const handleCancelImport = async () => {
    if (latestJob) {
      try {
        await client.cancelImport(latestJob.job_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const cacheState = isJobRunning
    ? "构建中"
    : latestJob?.stage === "Failed"
      ? "失败"
      : dataset
        ? "Ready"
        : "无";

  const datasetFileName = getDatasetFileName(dataset);
  const isLibrary = view === "library";

  // 播放（B.9 rev.5）：按真实帧间隔推进游标，到窗口末端回到起点；离开分析页自动暂停
  const windowRef = useRef(window);
  windowRef.current = window;
  const cursorRef = useRef(cursorT);
  cursorRef.current = cursorT;

  useEffect(() => {
    if (!playing || view !== "analysis") return;
    let frame = 0;
    let previous = globalThis.performance.now();
    const tick = (now: number) => {
      const vp = windowRef.current;
      const elapsed = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      const next = cursorRef.current + elapsed;
      if (next > vp.end || next < vp.start) {
        cursorRef.current = vp.start;
        setCursor(vp.start);
      } else {
        cursorRef.current = next;
        setCursor(next);
      }
      frame = globalThis.requestAnimationFrame(tick);
    };
    frame = globalThis.requestAnimationFrame(tick);
    return () => globalThis.cancelAnimationFrame(frame);
  }, [playing, view, setCursor]);

  // 空格 = 播放/暂停（输入框聚焦时不触发）
  useEffect(() => {
    if (view !== "analysis") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useAppStore.getState().playing);
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [view, setPlaying]);

  const handleExportCheckedChannels = async () => {
    if (!dataset || checkedChannels.length === 0) {
      setError("请先在左栏勾选要导出的通道");
      return;
    }
    try {
      const outPath = await client.pickExportFile(`${datasetFileName.replace(/\.[^.]+$/, "")}_selected.csv`);
      if (!outPath) return;
      const duration = dataset.meta.duration > 0 ? dataset.meta.duration : 1e9;
      await client.exportCsv(dataset.id, checkedChannels, 0, duration, outPath);
      setError(`已导出 ${checkedChannels.length} 个通道`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg)",
        color: "var(--text)",
        overflow: "hidden",
      }}
    >
      {/* 一级栏（9.5）：全红底 + 白色 logo 图 + 白字导航，F1 转播栏样式 */}
      <header
        className="app-shell__topbar"
        style={{
          height: "var(--topbar-height, 54px)",
          minHeight: "var(--topbar-height, 54px)",
          maxHeight: "var(--topbar-height, 54px)",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "0 16px",
          background: "var(--red)",
          flex: "none",
          userSelect: "none",
        }}
      >
        {/* Logo：白色 logo 图（负责人 2026-09-16 指定） */}
        <img
          src={logoUrl}
          alt="SCUT Racing Telemetry"
          style={{ height: "22px", width: "auto", display: "block", flex: "none" }}
        />

        {/* 中部：资料库导航（英文 tab）/ 分析页副标题（文件名在状态栏已有，不重复） */}
        {isLibrary ? (
          <nav
            data-testid="library-nav"
            style={{ display: "flex", alignItems: "stretch", height: "100%", marginLeft: "24px" }}
          >
            <span className="nav-tab nav-tab--active" data-testid="nav-database">
              DATABASE
            </span>
            <span
              className="nav-tab nav-tab--disabled"
              title="遥测视频导出（遥测数据叠加车载画面生成视频）将于后续版本提供"
            >
              TELEMETRY VIDEO
            </span>
            <span className="nav-tab nav-tab--disabled" title="WiFi 设备下载于 Step 13 启用">
              WIFI DOWNLOAD
            </span>
          </nav>
        ) : (
          <span
            className="app-shell__dataset-title"
            style={{
              color: "#FFFFFF",
              fontWeight: 700,
              fontSize: "12px",
              letterSpacing: "2px",
              whiteSpace: "nowrap",
            }}
          >
            DATA ANALYSIS
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* 右侧按钮组 */}
        <div className="app-shell__tools" style={{ display: "flex", alignItems: "center", gap: "10px", flex: "none" }}>
          {!isLibrary && (
            <>
              <GhostButton onRed testId="open-library" onClick={() => setView("library")} title="返回 DATABASE">
                BACK
              </GhostButton>
              <GhostButton
                onRed
                testId="play-button"
                onClick={() => setPlaying(!playing)}
                title={playing ? "暂停（空格）" : "播放（空格）"}
              >
                {playing ? "❚❚ PAUSE" : "▶ PLAY"}
              </GhostButton>
              <GhostButton onRed testId="export-channels" onClick={() => void handleExportCheckedChannels()} title="导出当前勾选通道的数据为 CSV">
                EXPORT
              </GhostButton>
              <GhostButton onRed disabled title="双文件对比于 Step 15 启用">
                ADD COMPARE
              </GhostButton>
            </>
          )}
          <GhostButton onRed onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="切换主题">
            {theme === "dark" ? "☾ Dark" : "☀ Light"}
          </GhostButton>
        </div>
      </header>

      {/* 进度条（B.7）：顶栏红分隔线之下通栏 */}
      {latestJob && (isJobRunning || latestJob.stage === "Failed") && (
        <ImportProgressBar status={latestJob} onCancel={handleCancelImport} />
      )}

      {/* 错误通知 */}
      {error && (
        <div
          className="app-shell__error"
          style={{
            background: "var(--bg2)",
            borderLeft: "3px solid var(--red)",
            borderBottom: "1px solid var(--line)",
            color: "var(--text)",
            padding: "4px 16px",
            fontSize: "12px",
            display: "flex",
            justifyContent: "space-between",
            flex: "none",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "transparent", border: "none", color: "var(--dim)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 主区：资料库主页（P8）或 固定三栏分析布局（B.2） */}
      <main className="app-shell__main" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {isLibrary ? (
          <LibraryView />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr) 6px ${rightWidth}px`,
              width: "100%",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
        {/* 左栏：文件卡片 + 通道列表 */}
        <section
          data-testid="left-column"
          style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg)" }}
        >
          <FileCard />
          {ChannelTreePanel && <ChannelTreePanel />}
        </section>

        <ColumnSplitter
          side="left"
          startWidth={leftWidth}
          minWidth={LEFT_WIDTH_RANGE.min}
          maxWidth={LEFT_WIDTH_RANGE.max}
          onResize={setLeftWidth}
        />

        {/* 中栏：图表堆叠区 + 时间轴（时间轴位于中栏底部，R3 重做为 canvas） */}
        <section
          data-testid="mid-column"
          style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}
        >
          <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
            {PlotStackPanel && <PlotStackPanel />}
          </div>
          <TimelineBar />
        </section>

        <ColumnSplitter
          side="right"
          startWidth={rightWidth}
          minWidth={RIGHT_WIDTH_RANGE.min}
          maxWidth={RIGHT_WIDTH_RANGE.max}
          onResize={setRightWidth}
        />

        {/* 右栏：赛道图 300px + 统计/批注（R4 重做为通道详情卡） */}
        <section
          data-testid="right-column"
          style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden", background: "var(--bg)" }}
        >
          <div style={{ height: "300px", flex: "none", borderBottom: "1px solid var(--line)", overflow: "hidden" }}>
            {TrackMapPanelComponent && <TrackMapPanelComponent />}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
            {StatsPanelComponent && <StatsPanelComponent />}
            {CommentsPanelComponent && <CommentsPanelComponent />}
          </div>
        </section>
          </div>
        )}
      </main>

      {/* 状态栏 24px（B.2 保留）：--bg2 底 + 1px --line 上边线（分析视图） */}
      {!isLibrary && (
      <footer
        className="app-shell__statusbar"
        style={{
          height: "var(--statusbar-height, 24px)",
          minHeight: "var(--statusbar-height, 24px)",
          maxHeight: "var(--statusbar-height, 24px)",
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          background: "var(--bg2)",
          borderTop: "1px solid var(--line)",
          fontSize: "11px",
          color: "var(--dim)",
          gap: "12px",
          flex: "none",
          userSelect: "none",
        }}
      >
        <span className="tnum" data-testid="statusbar-cursor">t={formatClockTime(cursorT)}</span>
        <span style={{ color: "var(--line)" }}>|</span>
        <span className="tnum" data-testid="statusbar-window">
          视口 [{window.start.toFixed(2)}s ~ {window.end.toFixed(2)}s]
        </span>
        <span style={{ color: "var(--line)" }}>|</span>
        <span className="tnum" data-testid="statusbar-channels">
          通道 {checkedChannels.length}/{dataset?.channels.length ?? 0}
        </span>
        <span style={{ color: "var(--line)" }}>|</span>
        <span data-testid="statusbar-cache">缓存: {cacheState}</span>
        <span style={{ color: "var(--line)" }}>|</span>
        <span className="tnum" data-testid="statusbar-generation">代际: {generation}</span>
        <span style={{ marginLeft: "auto", color: "var(--dim2)" }}>
          {dataset ? datasetFileName : "无活跃文件"}
        </span>
      </footer>
      )}
    </div>
  );
};
