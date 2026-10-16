import fs from "node:fs/promises";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import type { Limits } from "./config.js";
import { UserError } from "./errors.js";
import { EXTENSIONS, isHeic, type OutputFormat } from "./formats.js";
import { decodeHeic } from "./heic.js";
import type { PathGuard } from "./pathGuard.js";

sharp.cache(false);

export interface ConvertOptions {
  format: OutputFormat;
  /** 0.5 - 1.0, default 0.85. Ignored for PNG (lossless). */
  quality?: number;
  /** Keep EXIF/ICC/XMP metadata. Default false: metadata (incl. GPS) is stripped. */
  keepMetadata?: boolean;
}

export interface ConvertedImage {
  data: Buffer;
  width: number;
  height: number;
  format: OutputFormat;
}

export const DEFAULT_QUALITY = 0.85;

export function validateQuality(q: number | undefined): number {
  const v = q ?? DEFAULT_QUALITY;
  if (!Number.isFinite(v) || v < 0.5 || v > 1) {
    throw new UserError(`quality must be between 0.5 and 1.0 (got ${q}). Use 0.85 for a good size/quality balance.`, "BAD_QUALITY");
  }
  return v;
}

/** Convert an in-memory image buffer. Exported for tests. */
export async function convertBuffer(input: Buffer, opts: ConvertOptions, limits: Limits): Promise<ConvertedImage> {
  if (input.length > limits.maxInputBytes) {
    throw new UserError(`Input is ${(input.length / 1048576).toFixed(1)} MB, above the ${limits.maxInputBytes / 1048576} MB limit. Raise --max-input-mb if needed.`, "INPUT_TOO_LARGE");
  }
  const quality = Math.round(validateQuality(opts.quality) * 100);
  const limitInputPixels = Math.floor(limits.maxMegapixels * 1e6);

  let pipeline: Sharp;
  if (isHeic(input)) {
    if (!limits.heicEnabled) {
      throw new UserError("HEIC decoding is disabled on this server (--no-heic / LOCAL_IMAGE_CONVERT_NO_HEIC). Convert the file elsewhere or restart without that option.", "HEIC_DISABLED");
    }
    const raw = await decodeHeic(input, limits.maxMegapixels);
    pipeline = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: raw.channels }, limitInputPixels });
  } else {
    pipeline = sharp(input, { limitInputPixels, failOn: "error", animated: false, sequentialRead: true });
    // Auto-orient using EXIF before the metadata is stripped.
    pipeline = pipeline.rotate();
  }
  if (opts.keepMetadata) pipeline = pipeline.keepMetadata();

  switch (opts.format) {
    case "jpeg":
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });
      break;
    case "png":
      pipeline = pipeline.png({ compressionLevel: 9 });
      break;
    case "webp":
      pipeline = pipeline.webp({ quality, lossless: quality >= 100 });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality, lossless: quality >= 100 });
      break;
    default:
      throw new UserError(`Unsupported output format "${String(opts.format)}". Use one of: jpeg, png, webp, avif.`, "BAD_FORMAT");
  }
  try {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, format: opts.format };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (/pixel limit/i.test(msg)) {
      throw new UserError(`Image exceeds the ${limits.maxMegapixels} MP limit (possible decompression bomb). Raise --max-megapixels if you trust this file.`, "TOO_MANY_PIXELS");
    }
    if (/unsupported image format|Input buffer contains unsupported/i.test(msg)) {
      throw new UserError("Unsupported or unrecognised input format. Supported inputs: JPEG, PNG, WebP, AVIF, GIF (first frame), TIFF, HEIC/HEIF.", "UNSUPPORTED_INPUT");
    }
    throw new UserError(`Conversion failed: ${msg}`, "CONVERT_FAILED");
  }
}

export interface ConvertFileResult {
  input: string;
  output: string;
  format: OutputFormat;
  width: number;
  height: number;
  inputBytes: number;
  outputBytes: number;
  metadataStripped: boolean;
}

export async function readLimited(file: string, limits: Limits): Promise<Buffer> {
  const st = await fs.stat(file);
  if (st.size > limits.maxInputBytes) {
    throw new UserError(`Input file is ${(st.size / 1048576).toFixed(1)} MB, above the ${limits.maxInputBytes / 1048576} MB limit. Raise --max-input-mb if needed.`, "INPUT_TOO_LARGE");
  }
  return fs.readFile(file);
}

export async function convertFile(
  guard: PathGuard,
  limits: Limits,
  inputPath: string,
  opts: ConvertOptions & { outputDir?: string },
): Promise<ConvertFileResult> {
  const input = await guard.resolveInputFile(inputPath);
  const outDir = await guard.resolveOutputDir(opts.outputDir ?? (path.relative(guard.root, path.dirname(input)) || "."));
  const buf = await readLimited(input, limits);
  const out = await convertBuffer(buf, opts, limits);
  const base = path.basename(input, path.extname(input)) || "image";
  const output = await guard.writeNewFile(outDir, base, EXTENSIONS[opts.format], out.data);
  return {
    input,
    output,
    format: out.format,
    width: out.width,
    height: out.height,
    inputBytes: buf.length,
    outputBytes: out.data.length,
    metadataStripped: !opts.keepMetadata,
  };
}
