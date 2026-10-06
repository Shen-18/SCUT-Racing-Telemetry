import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import { AppShell } from "./components/AppShell";
import "./theme/tokens.css";
import "./theme/fonts.css";

describe("foundation shell (B.2 rev.5)", () => {
  it("renders the library home by default with P8 navigation", () => {
    const html = renderToStaticMarkup(<App />);
    // 红色一级栏（9.5）：白色 logo 图 + 英文导航
    expect(html).toContain("logo_white");
    expect(html).toContain("SCUT Racing Telemetry");
    expect(html).toContain("DATABASE");
    expect(html).toContain("OVERLAY");
    expect(html).toContain("WIFI DOWNLOAD");
    expect(html).not.toContain("library-secondary-bar");
    expect(html).toContain("pick-files");
    expect(html).toContain("BY DATE");
    expect(html).toContain("BY CAR");
    expect(html).not.toContain("canvas");
  });

  it("renders the analysis three-column layout with resizable splitters", () => {
    const html = renderToStaticMarkup(<AppShell viewOverride="analysis" />);
    expect(html).toContain("left-column");
    expect(html).toContain("mid-column");
    expect(html).toContain("right-column");
    expect(html).toContain('role="separator"');
    expect(html).toContain("statusbar-cursor");
    expect(html).toContain("statusbar-cache");
  });

  it("keeps the navigation visible and switches the top bar to the video blue", () => {
    const html = renderToStaticMarkup(<AppShell viewOverride="overlay" />);
    expect(html).toContain("data-testid=\"library-nav\"");
    expect(html).toContain("DATABASE");
    expect(html).toContain("OVERLAY");
    expect(html).toContain("background:#2A4A98");
    expect(html).not.toContain('title="返回 DATABASE"');
  });

  it("renders with F1 design token variables", () => {
    const html = renderToStaticMarkup(<AppShell viewOverride="analysis" />);
    expect(html).toContain("var(--topbar-height");
    expect(html).toContain("var(--statusbar-height");
    expect(html).toContain("var(--bg)");
    expect(html).toContain("var(--bg2)");
    expect(html).toContain("var(--red)");
  });
});
