import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, tmpRoot } from "./helpers";

// Inspector-style smoke test: spawn the built server over stdio, list tools, call them.
let client: Client;
let root: string;

beforeAll(async () => {
  root = await tmpRoot();
  await fs.copyFile(path.join(FIXTURES, "tiny.heic"), path.join(root, "IMG.heic"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(__dirname, "..", "dist", "index.js"), "--root", root],
    stderr: "pipe",
  });
  client = new Client({ name: "smoke", version: "0.0.0" });
  await client.connect(transport);
}, 20000);

afterAll(async () => {
  await client?.close();
});

describe("startup", () => {
  it("refuses to start without --root", async () => {
    const { spawnSync } = await import("node:child_process");
    const env = { ...process.env };
    delete env.LOCAL_IMAGE_CONVERT_ROOT;
    const r = spawnSync(process.execPath, [path.resolve(__dirname, "..", "dist", "index.js")], { env, encoding: "utf8", input: "" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--root/);
  });
});

describe("stdio smoke", () => {
  it("lists tools with the expected annotations", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["batch_convert", "convert_image"]);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    }
  });

  it("converts HEIC to webp", async () => {
    const r = (await client.callTool({ name: "convert_image", arguments: { input: "IMG.heic", format: "webp" } })) as any;
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(r.structuredContent.output).toBe(path.join(root, "IMG.webp"));
    expect((await fs.stat(path.join(root, "IMG.webp"))).size).toBeGreaterThan(0);
  });

  it("returns a clear tool error for paths outside the root", async () => {
    const r = (await client.callTool({ name: "convert_image", arguments: { input: "../../etc/passwd", format: "png" } })) as any;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/outside the allowed root/);
  });

  it("batch converts into a zip", async () => {
    const r = (await client.callTool({ name: "batch_convert", arguments: { inputs: ["IMG.heic"], format: "jpeg", outputDir: "out", zip: true } })) as any;
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.zip).toBe(path.join(root, "out", "converted.zip"));
  });
});
