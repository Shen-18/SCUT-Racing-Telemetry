import React, { useEffect, useRef, useState, useCallback } from "react";
import type { DockviewApi } from "dockview";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useAppStore } from "../state/appStore";
import * as client from "../api/client";
import {
  createPlotOptions,
  frameToAlignedData,
  requiresPlotRebuild,
  resizePlot,
  type PlotIdentity,
} from "../plot/uPlotFactory";
import type { WindowFrame } from "../api/types";

export interface PlotStackProps {
  api: DockviewApi;
}

export const PlotStack: React.FC<PlotStackProps> = ({ api }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const plotIdentityRef = useRef<PlotIdentity | null>(null);

  const dataset = useAppStore((s) => s.dataset);
  const checkedChannels = useAppStore((s) => s.checkedChannels);
  const window = useAppStore((s) => s.window);
  const generation = useAppStore((s) => s.generation);
  const currentFrame = useAppStore((s) => s.currentFrame);
  const theme = useAppStore((s) => s.theme);
  const applyFrame = useAppStore((s) => s.applyFrame);
  const setWindow = useAppStore((s) => s.setWindow);
  const setCursor = useAppStore((s) => s.setCursor);
  const importJobs = useAppStore((s) => s.importJobs);
  const prioritizeImport = useAppStore((s) => s.prioritizeImport);

  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to speed channel, or first checked channel
  const activeChannel = client.selectActiveChannel(dataset?.channels, checkedChannels);

  // Sizing helper
  const updateSize = useCallback(() => {
    if (containerRef.current && plotRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) {
        resizePlot(plotRef.current, Math.floor(rect.width), Math.floor(rect.height));
      }
    }
  }, []);

  // Hook into dockview onDidLayoutChange
  useEffect(() => {
    if (!api) return;
    const disposable = api.onDidLayoutChange(() => {
      updateSize();
    });
    return () => {
      disposable.dispose();
    };
  }, [api, updateSize]);

  // Hook into ResizeObserver for container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      updateSize();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [updateSize]);

  // Fetch window series when dataset, activeChannel, window, or generation changes
  useEffect(() => {
    if (!dataset) return;
    let cancelled = false;
    const reqGen = generation;
    const width = containerRef.current?.clientWidth || 800;
    const pixels = Math.max(128, Math.min(4096, width));

    setLoading(true);
    setError(null);
    setBuilding(false);

    client
      .windowSeries(dataset.id, activeChannel, window.start, window.end, pixels, reqGen)
      .then((frame: WindowFrame) => {
        if (cancelled) return;
        setLoading(false);
        // Discard frame if generation changed during in-flight request
        const applied = applyFrame(frame);
        if (!applied) {
          // Discarded because outdated
          return;
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        const code = (err as { code?: string })?.code;
        if (code === "channel_building") {
          setBuilding(true);
          const activeJob = Object.values(importJobs).find((j) => !j.error);
          if (activeJob) {
            void prioritizeImport(activeJob.job_id, [activeChannel]);
          }
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [dataset, activeChannel, window.start, window.end, generation, applyFrame, importJobs, prioritizeImport]);

  // Initialize or update uPlot instance
  useEffect(() => {
    if (!containerRef.current) return;

    if (!currentFrame || currentFrame.times.length === 0) {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
        plotIdentityRef.current = null;
      }
      return;
    }

    const data = frameToAlignedData(currentFrame);
    const nextIdentity: PlotIdentity = {
      channel: currentFrame.header.channel,
      unit: currentFrame.header.unit,
      theme,
    };

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 300;

    if (plotRef.current && requiresPlotRebuild(plotIdentityRef.current, nextIdentity)) {
      plotRef.current.destroy();
      plotRef.current = null;
      plotIdentityRef.current = null;
    }

    if (!plotRef.current) {
      // Create new plot
      const options = createPlotOptions({
        channel: currentFrame.header.channel,
        unit: currentFrame.header.unit,
        width,
        height,
        onWindowChange: (w) => {
          setWindow(w);
        },
        onCursorChange: (t) => {
          setCursor(t);
        },
      });
      // Set initial scale to window
      options.scales = {
        ...options.scales,
        x: {
          time: false,
          auto: false,
          min: window.start,
          max: window.end,
        },
      };

      containerRef.current.innerHTML = "";
      plotRef.current = new uPlot(options, data, containerRef.current);
      plotIdentityRef.current = nextIdentity;
    } else {
      // Update existing plot data and scales
      plotRef.current.setData(data, true);
      plotRef.current.setScale("x", {
        min: window.start,
        max: window.end,
      });
    }
  }, [currentFrame, window.start, window.end, setWindow, setCursor, theme]);

  // Clean up plot on unmount
  useEffect(() => {
    return () => {
      if (plotRef.current) {
        plotRef.current.destroy();
        plotRef.current = null;
        plotIdentityRef.current = null;
      }
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-app)",
        position: "relative",
        overflow: "hidden",
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "6px 12px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--text-primary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600 }}>{activeChannel}</span>
          {currentFrame && (
            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>
              ({currentFrame.header.unit || "unit"}) · {currentFrame.header.buckets} buckets · gen{" "}
              {currentFrame.header.generation}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {loading && <span style={{ color: "var(--accent)", fontSize: "11px" }}>加载中…</span>}
          {building && (
            <span style={{ color: "var(--status-warning)", fontSize: "11px" }}>
              构建通道缓存中…
            </span>
          )}
          {error && (
            <span style={{ color: "var(--status-error)", fontSize: "11px" }}>{error}</span>
          )}
        </div>
      </div>

      {/* Main plot container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: "100%",
          minWidth: 0,
          minHeight: 0,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!dataset && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", fontSize: "13px" }}>
            <p>未加载数据集</p>
            <p style={{ fontSize: "11px", marginTop: "4px" }}>请在顶栏输入 XRK/AGX 路径进行导入</p>
          </div>
        )}

        {dataset && !currentFrame && !loading && !building && (
          <div style={{ color: "var(--text-muted)", textAlign: "center", fontSize: "13px" }}>
            <p>等待曲线数据…</p>
            <p style={{ fontSize: "11px", marginTop: "4px" }}>
              缓存金字塔就绪后将呈现 {activeChannel} 曲线
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
