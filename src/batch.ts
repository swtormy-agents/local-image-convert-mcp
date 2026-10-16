import fs from "node:fs/promises";
import path from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import type { Limits } from "./config.js";
import { convertBuffer, readLimited, type ConvertOptions } from "./convert.js";
import { UserError } from "./errors.js";
import { EXTENSIONS, INPUT_EXTENSIONS } from "./formats.js";
import { isWindowsReserved, type PathGuard } from "./pathGuard.js";

export interface BatchOptions extends ConvertOptions {
  inputs?: string[];
  inputDir?: string;
  outputDir: string;
  zip?: boolean;
  zipName?: string;
}

export interface BatchItem {
  input: string;
  ok: boolean;
  output?: string;
  outputBytes?: number;
  error?: string;
}

export interface BatchResult {
  items: BatchItem[];
  converted: number;
  failed: number;
  zip?: string;
}

async function collect(guard: PathGuard, opts: BatchOptions, limits: Limits): Promise<string[]> {
  const files: string[] = [];
  if (opts.inputs) files.push(...opts.inputs);
  if (opts.inputDir) {
    const dir = await guard.resolveInputDir(opts.inputDir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if ((e.isFile() || e.isSymbolicLink()) && INPUT_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        files.push(path.join(dir, e.name));
      }
    }
  }
  if (files.length === 0) {
    throw new UserError("No input images. Pass `inputs` (list of file paths) and/or `inputDir` (a directory with .jpg/.png/.webp/.avif/.gif/.tiff/.heic files).", "NO_INPUTS");
  }
  if (files.length > limits.maxBatchFiles) {
    throw new UserError(`Batch has ${files.length} files, above the limit of ${limits.maxBatchFiles}. Split it into smaller batches or raise --max-batch-files.`, "BATCH_TOO_LARGE");
  }
  return files;
}

export async function batchConvert(guard: PathGuard, limits: Limits, opts: BatchOptions): Promise<BatchResult> {
  const zipBase = (opts.zipName ?? "converted").replace(/\.zip$/i, "");
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(zipBase) || zipBase.startsWith(".") || isWindowsReserved(zipBase)) {
    throw new UserError("zipName may only contain letters, digits, '.', '_' and '-' (max 100 chars), must not start with '.', and must not be a reserved Windows name like CON or NUL. Example: \"photos\".", "BAD_ZIP_NAME");
  }
  const files = await collect(guard, opts, limits);
  const outDir = await guard.resolveOutputDir(opts.outputDir);
  const ext = EXTENSIONS[opts.format];
  const items: BatchItem[] = [];

  const convertOne = async (f: string) => {
    const input = await guard.resolveInputFile(f);
    const buf = await readLimited(input, limits);
    const out = await convertBuffer(buf, opts, limits);
    const base = path.basename(input, path.extname(input)) || "image";
    return { input, base, data: out.data };
  };
  const fail = (f: string, e: unknown) =>
    items.push({ input: f, ok: false, error: e instanceof UserError ? e.message : `Unexpected error: ${(e as Error).message}` });

  if (!opts.zip) {
    for (const f of files) {
      try {
        const { input, base, data } = await convertOne(f);
        const output = await guard.writeNewFile(outDir, base, ext, data);
        items.push({ input, ok: true, output, outputBytes: data.length });
      } catch (e) {
        fail(f, e);
      }
    }
    const converted = items.filter((i) => i.ok).length;
    return { items, converted, failed: items.length - converted };
  }

  // ZIP: the archive is created only after the first successful conversion, so a batch where nothing converts
  // never creates (and never has to delete) a zip file. Entries are streamed into the safely created file one at a
  // time, so memory stays around one image. Images are already compressed, so entries are stored without deflate.
  const usedNames = new Set<string>();
  let converted = 0;
  let idx = 0;
  let first: { input: string; base: string; data: Buffer } | undefined;
  while (idx < files.length && !first) {
    const f = files[idx++];
    try {
      first = await convertOne(f);
    } catch (e) {
      fail(f, e);
    }
  }
  if (!first) return { items, converted: 0, failed: items.length };
  const firstItem = first;

  const zipPath = await guard.writeNewFile(outDir, zipBase, "zip", async (fh) => {
    const zip = new yazl.ZipFile();
    // Count bytes flushed to disk so we only convert the next image once the previous one has been written.
    let flushed = 0;
    let queued = 0;
    let waiter: (() => void) | undefined;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        flushed += chunk.length;
        cb(null, chunk);
      },
    });
    // Plain Writable over the FileHandle (fh.createWriteStream would keep a ref that blocks fh.close()).
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        fh.write(chunk).then(() => cb(), cb);
      },
    });
    counter.on("data", () => waiter?.());
    const done = pipeline(zip.outputStream as NodeJS.ReadableStream, counter, sink);
    const waitFlushed = async () => {
      while (flushed < queued) await new Promise<void>((r) => ((waiter = r), setTimeout(r, 50)));
      waiter = undefined;
    };
    const add = async ({ input, base, data }: { input: string; base: string; data: Buffer }) => {
      let name = `${base}.${ext}`;
      for (let i = 1; usedNames.has(name); i++) name = `${base}-${i}.${ext}`;
      usedNames.add(name);
      zip.addBuffer(data, name, { compress: false });
      queued += data.length;
      await waitFlushed();
      items.push({ input, ok: true, output: name, outputBytes: data.length });
      converted++;
    };
    await add(firstItem);
    for (; idx < files.length; idx++) {
      const f = files[idx];
      try {
        await add(await convertOne(f));
      } catch (e) {
        fail(f, e);
      }
    }
    zip.end();
    await done;
  });
  return { items, converted, failed: items.length - converted, zip: zipPath };
}
