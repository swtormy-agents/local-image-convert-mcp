import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guard against accidentally adding network or telemetry code to the server.
describe("no network in source", () => {
  it("src/ imports no network modules and calls no fetch", async () => {
    const dir = path.resolve(__dirname, "..", "src");
    for (const f of await fs.readdir(dir)) {
      const s = await fs.readFile(path.join(dir, f), "utf8");
      expect(s, f).not.toMatch(/from\s+["'](node:)?(http|https|net|dgram|tls|dns|http2)["']/);
      expect(s, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    }
  });
});
