import React, { useEffect, useState } from "react";
import * as client from "../api/client";

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--line)",
  background: "var(--panel)",
  minWidth: 0,
};

const CHECKERBOARD: React.CSSProperties = {
  backgroundColor: "#15181d",
  backgroundImage:
    "linear-gradient(45deg, #20242b 25%, transparent 25%), linear-gradient(-45deg, #20242b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #20242b 75%), linear-gradient(-45deg, transparent 75%, #20242b 75%)",
  backgroundSize: "24px 24px",
  backgroundPosition: "0 0, 0 12px, 12px -12px, -12px 0",
};

export const CoverVideoView: React.FC = () => {
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState("READY TO GENERATE DEMO FRAME");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const generate = async () => {
    setError(null);
    try {
      const path = outputPath ?? (await client.pickCoverVideoFile());
      if (!path) return;
      setOutputPath(path);
      setStatus("RENDERING TRANSPARENT PNG…");
      const result = await client.generateCoverVideoDemo(path);
      const url = URL.createObjectURL(new Blob([Uint8Array.from(result.bytes)], { type: "image/png" }));
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
      setDimensions({ width: result.width, height: result.height });
      setStatus("DEMO FRAME READY");
    } catch (err) {
      setStatus("RENDER FAILED");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <main
      data-testid="cover-video-view"
      style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", padding: "24px", color: "var(--text)" }}
    >
      <div style={{ maxWidth: "1180px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px" }}>
          <div>
            <div style={{ color: "var(--red)", fontFamily: '"F1 Display", sans-serif', fontWeight: 700, fontSize: "11px", letterSpacing: "2px" }}>
              COVER VIDEO / DEMO
            </div>
            <h1 style={{ margin: "6px 0 0", fontFamily: '"F1 Display", sans-serif', fontSize: "22px", letterSpacing: "1.5px" }}>
              TRANSPARENT HUD FRAME
            </h1>
            <p style={{ margin: "8px 0 0", color: "var(--dim)", fontSize: "13px" }}>
              Rust renderer · fixed sample values · PNG with alpha channel
            </p>
          </div>
          <button className="ghost-button" onClick={() => void generate()} style={{ background: "var(--red)", border: "1px solid var(--red)", color: "#fff", padding: "9px 16px", fontFamily: '"F1 Display", sans-serif', fontWeight: 700, letterSpacing: "1px", cursor: "pointer", flex: "none" }}>
            GENERATE PNG
          </button>
        </header>

        <section style={{ ...CARD_STYLE, padding: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--dim)", fontFamily: '"F1 Display", sans-serif', fontSize: "11px", letterSpacing: "1.5px" }}>
            <span style={{ width: "3px", height: "12px", background: "var(--red)" }} />
            PREVIEW
            <span style={{ marginLeft: "auto", color: status.includes("FAILED") ? "var(--red)" : "var(--dim2)" }}>{status}</span>
          </div>
          <div style={{ ...CHECKERBOARD, marginTop: "12px", minHeight: "420px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Transparent telemetry HUD demo" style={{ display: "block", width: "100%", height: "auto" }} />
            ) : (
              <div style={{ color: "var(--dim2)", fontFamily: '"F1 Display", sans-serif', fontSize: "12px", letterSpacing: "1.5px" }}>
                NO FRAME GENERATED
              </div>
            )}
          </div>
        </section>

        <section style={{ ...CARD_STYLE, padding: "14px", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "12px 24px", alignItems: "center" }}>
          <div>
            <div style={{ color: "var(--dim2)", fontFamily: '"F1 Display", sans-serif', fontSize: "10px", letterSpacing: "1.5px" }}>OUTPUT FILE</div>
            <div style={{ marginTop: "5px", color: outputPath ? "var(--text)" : "var(--dim2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={outputPath ?? undefined}>
              {outputPath ?? "Choose a path when generating"}
            </div>
          </div>
          <div style={{ textAlign: "right", color: "var(--dim2)", fontFamily: '"F1 Display", sans-serif', fontSize: "11px", letterSpacing: "1px" }}>
            {dimensions ? `${dimensions.width} × ${dimensions.height} / RGBA` : "2560 × 1440 / RGBA"}
          </div>
          {error && <div style={{ gridColumn: "1 / -1", borderLeft: "3px solid var(--red)", paddingLeft: "10px", color: "var(--red)", fontSize: "12px" }}>{error}</div>}
        </section>
      </div>
    </main>
  );
};
