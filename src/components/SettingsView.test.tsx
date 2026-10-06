import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("exposes the database channel selection setting", () => {
    const html = renderToStaticMarkup(<SettingsView />);
    expect(html).toContain("settings-view");
    expect(html).toContain("记住上次选择的通道");
    expect(html).toContain("remember-selected-channels-toggle");
  });
});
