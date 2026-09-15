import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App from "./App";
import "./theme/tokens.css";

describe("foundation shell", () => {
  it("renders the product identity without fake telemetry", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("SCUT Racing Telemetry");
    expect(html).toContain("<main");
    expect(html).not.toContain("canvas");
  });

  it("renders with design token variables", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("var(--topbar-height");
    expect(html).toContain("var(--statusbar-height");
    expect(html).toContain("var(--bg-app)");
    expect(html).toContain("var(--bg-panel)");
  });
});
