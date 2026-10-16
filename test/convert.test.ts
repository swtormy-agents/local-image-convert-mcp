import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { batchConvert } from "../src/batch";
import { assertSafeRoot, DEFAULT_LIMITS, loadConfig } from "../src/config";
import { convertBuffer, convertFile } from "../src/convert";
import { PathGuard, testHooks } from "../src/pathGuard";
import { bombPng, FIXTURES, jpegWithExif, pngRgba, tmpRoot } from "./helpers";

let root: string;
let guard: PathGuard;
const L = DEFAULT_LIMITS;

beforeAll(async () => {
  root = await tmpRoot();
  await fs.mkdir(path.join(root, "in"));
  await fs.writeFile(path.join(root, "in", "photo.jpg"), await jpegWithExif());
  await fs.writeFile(path.join(root, "in", "alpha.png"), await pngRgba());
  await fs.copyFile(path.join(FIXTURES, "tiny.heic"), path.join(root, "in", "tiny.heic"));
  await fs.writeFile(path.join(root, "in", "broken.webp"), "not an image");
  guard = await PathGuard.create(root);
});

describe("convertBuffer", () => {
  it.each(["jpeg", "png", "webp", "avif"] as const)("converts PNG to %s", async (format) => {
    const out = await convertBuffer(await pngRgba(), { format }, L);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe(format === "avif" ? "heif" : format);
    expect([meta.width, meta.height]).toEqual([20, 10]);
  });

  it("decodes HEIC via libheif wasm", async () => {
    const out = await convertBuffer(await fs.readFile(path.join(FIXTURES, "tiny.heic")), { format: "png" }, L);
    expect([out.width, out.height]).toEqual([64, 48]);
    const multi = await convertBuffer(await fs.readFile(path.join(FIXTURES, "multi.heic")), { format: "jpeg" }, L);
    expect(multi.width).toBe(64);
  });

  it("strips XMP and ICC by default", async () => {
    const src = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#808080" } })
      .withIccProfile("p3")
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="fixture"/></rdf:RDF></x:xmpmeta>')
      .jpeg()
      .toBuffer();
    const m0 = await sharp(src).metadata();
    expect(m0.xmp).toBeDefined();
    expect(m0.icc).toBeDefined();
    for (const format of ["jpeg", "png", "webp", "avif"] as const) {
      const m = await sharp((await convertBuffer(src, { format }, L)).data).metadata();
      expect(m.xmp, format).toBeUndefined();
      expect(m.icc, format).toBeUndefined();
      expect(m.exif, format).toBeUndefined();
    }
  });

  it("applies HEIC irot rotation", async () => {
    const out = await convertBuffer(await fs.readFile(path.join(FIXTURES, "rotated.heic")), { format: "png" }, L);
    expect([out.width, out.height]).toEqual([48, 64]);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    const [rt, , bt] = px(24, 5);
    const [rb, , bb] = px(24, 58);
    expect(rt).toBeGreaterThan(200);
    expect(bt).toBeLessThan(60);
    expect(bb).toBeGreaterThan(200);
    expect(rb).toBeLessThan(60);
  });

  it("refuses HEIC when the kill-switch is on", async () => {
    await expect(convertBuffer(await fs.readFile(path.join(FIXTURES, "tiny.heic")), { format: "png" }, { ...L, heicEnabled: false })).rejects.toMatchObject({ code: "HEIC_DISABLED" });
  });

  it("strips EXIF by default and keeps it on request", async () => {
    const src = await jpegWithExif();
    expect((await sharp(src).metadata()).exif).toBeDefined();
    const stripped = await convertBuffer(src, { format: "jpeg" }, L);
    expect((await sharp(stripped.data).metadata()).exif).toBeUndefined();
    const kept = await convertBuffer(src, { format: "jpeg", keepMetadata: true }, L);
    expect((await sharp(kept.data).metadata()).exif).toBeDefined();
  });

  it("higher quality gives a bigger jpeg", async () => {
    const img = await sharp({ create: { width: 64, height: 64, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
    const lo = await convertBuffer(img, { format: "jpeg", quality: 0.5 }, L);
    const hi = await convertBuffer(img, { format: "jpeg", quality: 1 }, L);
    expect(hi.data.length).toBeGreaterThan(lo.data.length);
  });

  it("validates quality range", async () => {
    await expect(convertBuffer(await pngRgba(), { format: "jpeg", quality: 0.3 }, L)).rejects.toMatchObject({ code: "BAD_QUALITY" });
    await expect(convertBuffer(await pngRgba(), { format: "jpeg", quality: 1.5 }, L)).rejects.toMatchObject({ code: "BAD_QUALITY" });
  });

  it("rejects decompression bombs by megapixel limit", async () => {
    await expect(convertBuffer(bombPng(), { format: "jpeg" }, L)).rejects.toMatchObject({ code: "TOO_MANY_PIXELS" });
    const heic = await fs.readFile(path.join(FIXTURES, "tiny.heic"));
    await expect(convertBuffer(heic, { format: "png" }, { ...L, maxMegapixels: 0.001 })).rejects.toMatchObject({ code: "TOO_MANY_PIXELS" });
  });

  it("rejects oversized and unknown input", async () => {
    await expect(convertBuffer(await pngRgba(), { format: "png" }, { ...L, maxInputBytes: 10 })).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    await expect(convertBuffer(Buffer.from("hello world, not an image"), { format: "png" }, L)).rejects.toMatchObject({ code: "UNSUPPORTED_INPUT" });
  });
});

describe("convertFile / batchConvert", () => {
  it("writes next to the input and never overwrites", async () => {
    await fs.mkdir(path.join(root, "single"));
    await fs.copyFile(path.join(root, "in", "photo.jpg"), path.join(root, "single", "photo.jpg"));
    const a = await convertFile(guard, L, "single/photo.jpg", { format: "webp" });
    const b = await convertFile(guard, L, "single/photo.jpg", { format: "webp" });
    expect(a.output).toBe(path.join(root, "single", "photo.webp"));
    expect(b.output).toBe(path.join(root, "single", "photo-1.webp"));
    expect(a.metadataStripped).toBe(true);
  });

  it.skipIf(process.platform === "win32")("does not write through a pre-existing symlink at the target name (skipped on Windows: symlinks need privileges)", async () => {
    const outside = await tmpRoot();
    await fs.mkdir(path.join(root, "trap"));
    await fs.symlink(path.join(outside, "pwned.png"), path.join(root, "trap", "photo.png"));
    const r = await convertFile(guard, L, "in/photo.jpg", { format: "png", outputDir: "trap" });
    expect(r.output).toBe(path.join(root, "trap", "photo-1.png"));
    await expect(fs.stat(path.join(outside, "pwned.png"))).rejects.toThrow();
  });

  it("batch converts a directory to files, reporting bad files", async () => {
    const r = await batchConvert(guard, L, { inputDir: "in", format: "png", outputDir: "batch-out" });
    expect(r.items.length).toBe(4);
    expect(r.converted).toBe(3);
    expect(r.items.find((i) => i.input.endsWith("broken.webp"))?.ok).toBe(false);
    const files = (await fs.readdir(path.join(root, "batch-out"))).sort();
    expect(files).toEqual(["alpha.png", "photo.png", "tiny.png"]);
  });

  it("batch converts a list into a zip", async () => {
    const r = await batchConvert(guard, L, { inputs: ["in/photo.jpg", "in/tiny.heic"], format: "jpeg", outputDir: "zip-out", zip: true, zipName: "pics" });
    expect(r.zip).toBe(path.join(root, "zip-out", "pics.zip"));
    const z = await fs.readFile(r.zip!);
    expect(z.subarray(0, 2).toString()).toBe("PK");
    expect(z.includes(Buffer.from("photo.jpg"))).toBe(true);
    expect(z.includes(Buffer.from("tiny.jpg"))).toBe(true);
  });

  it("leaves no zip when nothing converted", async () => {
    const r = await batchConvert(guard, L, { inputs: ["in/broken.webp"], format: "png", outputDir: "zip-empty", zip: true });
    expect(r.converted).toBe(0);
    expect(r.zip).toBeUndefined();
    expect(await fs.readdir(path.join(root, "zip-empty"))).toEqual([]);
  });

  it("never creates a zip (so never has to delete one) when nothing converts", async () => {
    let writes = 0;
    testHooks.beforeWrite = () => {
      writes++;
    };
    try {
      const r = await batchConvert(guard, L, { inputs: ["in/broken.webp", "in/broken.webp"], format: "png", outputDir: "zip-none", zip: true });
      expect(r.converted).toBe(0);
      expect(r.failed).toBe(2);
      expect(r.zip).toBeUndefined();
    } finally {
      testHooks.beforeWrite = undefined;
    }
    expect(writes).toBe(0);
  });

  it("creates the zip after the first success and keeps later items", async () => {
    const r = await batchConvert(guard, L, { inputs: ["in/broken.webp", "in/photo.jpg", "in/broken.webp", "in/tiny.heic"], format: "png", outputDir: "zip-mixed", zip: true, zipName: "mixed" });
    expect(r.converted).toBe(2);
    expect(r.failed).toBe(2);
    expect(r.items.map((i) => i.ok)).toEqual([false, true, false, true]);
    expect(r.zip).toBe(path.join(root, "zip-mixed", "mixed.zip"));
  });

  it("enforces batch limits and zip name", async () => {
    await expect(batchConvert(guard, { ...L, maxBatchFiles: 1 }, { inputDir: "in", format: "png", outputDir: "x" })).rejects.toMatchObject({ code: "BATCH_TOO_LARGE" });
    for (const zipName of ["../evil", "a b", "x:y", "CON", "nul.zip", ".hidden", "ü", "a/b"]) {
      await expect(batchConvert(guard, L, { inputs: ["in/photo.jpg"], format: "png", outputDir: "x", zip: true, zipName }), zipName).rejects.toMatchObject({ code: "BAD_ZIP_NAME" });
    }
    await expect(batchConvert(guard, L, { format: "png", outputDir: "x" })).rejects.toMatchObject({ code: "NO_INPUTS" });
  });
});

describe("config", () => {
  const home = path.resolve("/home/u");
  const H = [home];
  it("parses flags and env", () => {
    const c = loadConfig(["--root", "pics", "--max-megapixels=5"], { LOCAL_IMAGE_CONVERT_MAX_INPUT_MB: "2" }, home, H);
    expect(c.allowedRoot).toBe(path.join(home, "pics"));
    expect(c.limits.maxMegapixels).toBe(5);
    expect(c.limits.maxInputBytes).toBe(2 * 1048576);
    expect(c.limits.heicEnabled).toBe(true);
    expect(loadConfig([], { LOCAL_IMAGE_CONVERT_ROOT: path.resolve("/w") }, home, H).allowedRoot).toBe(path.resolve("/w"));
    expect(() => loadConfig(["--root", "x", "--max-megapixels", "-1"], {}, home, H)).toThrow(/positive/);
  });
  it("requires a root and refuses /, the home dir and its ancestors", () => {
    expect(() => loadConfig([], {}, home, H)).toThrow(/--root/);
    expect(() => loadConfig(["--root", path.parse(home).root], {}, home, H)).toThrow(/filesystem root/);
    expect(() => loadConfig(["--root", home], {}, home, H)).toThrow(/home directory/);
    expect(() => loadConfig(["--root", "."], {}, home, H)).toThrow(/home directory/);
    expect(() => loadConfig(["--root", ".."], {}, home, H)).toThrow(/home directory/);
    expect(() => loadConfig([], { LOCAL_IMAGE_CONVERT_ROOT: home + path.sep }, home, H)).toThrow(/home directory/);
    expect(() => loadConfig(["--root", "/srv/x"], {}, home, H)).not.toThrow();
    for (const t of ["~", "~/Pictures", "~\\Pictures", "~alice/pics"]) {
      expect(() => loadConfig(["--root", t], {}, home, H), t).toThrow(expect.objectContaining({ code: "ROOT_TILDE" }));
    }
    expect(() => loadConfig([], { LOCAL_IMAGE_CONVERT_ROOT: "~/x" }, home, H)).toThrow(/not expanded/);
    expect(() => loadConfig(["--root", "a~b"], {}, home, H)).not.toThrow();
  });
  it.skipIf(process.platform === "win32")("compares after realpath (symlinked home; skipped on Windows: symlinks need privileges)", async () => {
    const base = await tmpRoot();
    const realHome = path.join(base, "realhome");
    await fs.mkdir(realHome);
    await fs.symlink(realHome, path.join(base, "homelink"));
    // $HOME is the symlink, root is the real dir (and vice versa)
    expect(() => assertSafeRoot(realHome, [path.join(base, "homelink")])).toThrow(/home directory/);
    expect(() => assertSafeRoot(path.join(base, "homelink"), [realHome])).toThrow(/home directory/);
    expect(() => assertSafeRoot(base, [path.join(base, "homelink")])).toThrow(/home directory/);
    expect(() => assertSafeRoot(path.join(realHome), [path.join(base, "other")])).not.toThrow();
  });
  it("supports the HEIC kill-switch", () => {
    expect(loadConfig(["--no-heic", "--root", "p"], {}, home, H).limits.heicEnabled).toBe(false);
    expect(loadConfig(["--root", "p"], { LOCAL_IMAGE_CONVERT_NO_HEIC: "1" }, home, H).limits.heicEnabled).toBe(false);
  });
});
