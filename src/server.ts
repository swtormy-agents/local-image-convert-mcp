import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { batchConvert } from "./batch.js";
import type { Config } from "./config.js";
import { convertFile, DEFAULT_QUALITY } from "./convert.js";
import { UserError } from "./errors.js";
import { OUTPUT_FORMATS } from "./formats.js";
import { PathGuard } from "./pathGuard.js";

export const SERVER_NAME = "local-image-convert-mcp";
export const SERVER_VERSION = "0.1.0";

const annotations = {
  readOnlyHint: false, // writes new output files
  destructiveHint: false, // never overwrites or deletes; picks a fresh file name instead
  idempotentHint: false, // repeated calls create name-1, name-2, ...
  openWorldHint: false, // local files only, no network
} as const;

const common = {
  format: z.enum(OUTPUT_FORMATS).describe("Output format: jpeg, png, webp or avif."),
  quality: z
    .number()
    .min(0.5)
    .max(1)
    .default(DEFAULT_QUALITY)
    .describe("Quality 0.5-1.0 for jpeg/webp/avif (default 0.85; 1.0 = lossless for webp/avif). Ignored for png."),
  keepMetadata: z
    .boolean()
    .default(false)
    .describe("Keep EXIF/XMP metadata such as camera and GPS data. Default false: metadata is stripped (images are auto-rotated first)."),
};

function errorResult(e: unknown) {
  const msg = e instanceof UserError ? e.message : `Unexpected error: ${(e as Error)?.message ?? String(e)}`;
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

export async function createServer(config: Config): Promise<McpServer> {
  const guard = await PathGuard.create(config.allowedRoot);
  const { limits } = config;
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "convert_image",
    {
      title: "Convert image",
      description:
        `Convert one local image (JPEG, PNG, WebP, AVIF, GIF, TIFF, HEIC/HEIF) to jpeg, png, webp or avif. ` +
        `Runs entirely on this machine; nothing is uploaded. Paths are relative to the allowed root (${guard.root}). ` +
        `Writes a new file and never overwrites existing ones. Returns the output path and sizes.`,
      inputSchema: {
        input: z.string().describe("Path of the source image, relative to the allowed root (absolute paths inside the root also work). Example: photos/IMG_0001.heic"),
        ...common,
        outputDir: z.string().optional().describe("Directory for the result, relative to the allowed root. Created if missing. Default: same directory as the input."),
      },
      annotations: { ...annotations, title: "Convert image" },
    },
    async (args) => {
      try {
        const r = await convertFile(guard, limits, args.input, args);
        const text = `Converted ${r.input} -> ${r.output} (${r.width}x${r.height}, ${r.inputBytes} -> ${r.outputBytes} bytes${r.metadataStripped ? ", metadata stripped" : ""}).`;
        return { content: [{ type: "text" as const, text }], structuredContent: { ...r } };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    "batch_convert",
    {
      title: "Batch convert images",
      description:
        `Convert several local images at once, from a list of paths and/or a directory (non-recursive). ` +
        `Writes the results as separate files or as one .zip archive into outputDir. Continues past bad files and reports each error. ` +
        `Runs entirely on this machine. Limit: ${limits.maxBatchFiles} files per call.`,
      inputSchema: {
        inputs: z.array(z.string()).optional().describe("List of image paths relative to the allowed root."),
        inputDir: z.string().optional().describe("Directory whose images (jpg, png, webp, avif, gif, tiff, heic) are converted. Not recursive."),
        ...common,
        outputDir: z.string().describe("Directory for the results, relative to the allowed root. Created if missing."),
        zip: z.boolean().default(false).describe("Pack all results into one zip file instead of separate files."),
        zipName: z.string().optional().describe("Zip file name without path (default: converted.zip)."),
      },
      annotations: { ...annotations, title: "Batch convert images" },
    },
    async (args) => {
      try {
        const r = await batchConvert(guard, limits, args);
        const lines = [`Converted ${r.converted} of ${r.items.length} file(s)${r.zip ? ` into ${r.zip}` : ""}.`];
        for (const i of r.items) lines.push(i.ok ? `OK   ${i.input} -> ${i.output}` : `FAIL ${i.input}: ${i.error}`);
        return { content: [{ type: "text" as const, text: lines.join("\n") }], structuredContent: { ...r }, isError: r.converted === 0 };
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  return server;
}
