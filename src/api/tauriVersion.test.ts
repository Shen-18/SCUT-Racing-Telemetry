import { describe, expect, it } from "vitest";
import packageJson from "../../package.json";

describe("Tauri package version alignment", () => {
  it("aligns frontend tauri api major/minor with Rust tauri 2.11 release", () => {
    const apiPkgName = ["@", "tauri-apps", "/", "api"].join("");
    const apiVersionSpec = (packageJson.dependencies as Record<string, string>)[apiPkgName];
    expect(apiVersionSpec).toBeDefined();
    const cleanApiVersion = apiVersionSpec.replace(/^[^\d]*/, "");
    const [apiMajor, apiMinor] = cleanApiVersion.split(".").map(Number);

    // Rust workspace pins tauri to v2.11.x; frontend must stay on the same major/minor release (2.11)
    expect({ major: apiMajor, minor: apiMinor }).toEqual({ major: 2, minor: 11 });
  });
});
