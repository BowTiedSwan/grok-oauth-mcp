import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("uses the universal grok-oauth-mcp package and binary name", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(pkg.name).toBe("grok-oauth-mcp");
    expect(pkg.bin).toEqual({ "grok-oauth-mcp": "dist/index.js" });
    expect(pkg.repository.url).toBe("git+https://github.com/bowtieswan/grok-oauth-mcp.git");
  });
});
