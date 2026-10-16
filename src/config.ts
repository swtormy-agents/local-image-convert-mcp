import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserError } from "./errors.js";

export interface Limits {
  /** Maximum input file size in bytes. */
  maxInputBytes: number;
  /** Maximum decoded image size in megapixels (decompression-bomb guard). */
  maxMegapixels: number;
  /** Maximum number of files in one batch_convert call. */
  maxBatchFiles: number;
  /** HEIC decoding via libheif wasm; false = kill-switch (--no-heic). */
  heicEnabled: boolean;
}

export interface Config {
  allowedRoot: string;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = {
  maxInputBytes: 100 * 1024 * 1024,
  maxMegapixels: 100,
  maxBatchFiles: 200,
  heicEnabled: true,
};

const BOOLEAN_FLAGS = new Set(["no-heic"]);

function num(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new UserError(`Invalid value for ${name}: "${value}". Expected a positive number.`, "BAD_CONFIG");
  }
  return n;
}

function truthy(v: string | undefined): boolean {
  return v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());
}

/** realpath of the deepest existing ancestor, with the missing tail appended (so both sides compare consistently). */
function realOrResolved(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...tail);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

function sameOrAncestor(ancestor: string, p: string): boolean {
  const norm = (x: string) => (process.platform === "win32" ? x.toLowerCase() : x);
  const rel = path.relative(norm(ancestor), norm(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Refuse obviously dangerous roots: a filesystem root ("/", "C:\\"), the home directory, or any ancestor of it
 * (e.g. /home, /Users). Both sides are compared after realpath, so symlinked homes are caught too.
 * `homes` is injectable for tests; by default os.homedir(), $HOME and %USERPROFILE%.
 */
export function assertSafeRoot(root: string, homes: string[] = [os.homedir(), process.env.HOME ?? "", process.env.USERPROFILE ?? ""]): void {
  const r = realOrResolved(root);
  if (path.parse(r).root === r) {
    throw new UserError(`Refusing to use the filesystem root (${r}) as the allowed root. Pass a specific folder, e.g. --root ~/Pictures/to-convert.`, "ROOT_TOO_BROAD");
  }
  for (const h of homes.filter(Boolean)) {
    const home = realOrResolved(h);
    if (sameOrAncestor(r, home)) {
      throw new UserError(
        `Refusing to use ${r} as the allowed root: it is your home directory or contains it (${home}). Pass a specific folder inside your home, e.g. --root ~/Pictures/to-convert.`,
        "ROOT_TOO_BROAD",
      );
    }
  }
}

/**
 * Configuration comes from CLI flags (preferred) or environment variables.
 *   --root <dir>            / LOCAL_IMAGE_CONVERT_ROOT            (REQUIRED, no default)
 *   --max-input-mb <n>      / LOCAL_IMAGE_CONVERT_MAX_INPUT_MB    (default: 100)
 *   --max-megapixels <n>    / LOCAL_IMAGE_CONVERT_MAX_MEGAPIXELS  (default: 100)
 *   --max-batch-files <n>   / LOCAL_IMAGE_CONVERT_MAX_BATCH_FILES (default: 200)
 *   --no-heic               / LOCAL_IMAGE_CONVERT_NO_HEIC=1       (disable HEIC decoding)
 */
export function loadConfig(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env, cwd = process.cwd(), homes?: string[]): Config {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new UserError(`Unexpected argument "${a}". Options start with --, e.g. --root /path/to/folder.`, "BAD_CONFIG");
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (BOOLEAN_FLAGS.has(a.slice(2))) flags[a.slice(2)] = "true";
    else if (i + 1 < argv.length) flags[a.slice(2)] = argv[++i];
    else throw new UserError(`Option ${a} needs a value.`, "BAD_CONFIG");
  }
  const root = flags["root"] ?? env.LOCAL_IMAGE_CONVERT_ROOT;
  if (!root || !root.trim()) {
    throw new UserError(
      "No allowed root directory configured. Start the server with --root /absolute/path/to/folder (or set LOCAL_IMAGE_CONVERT_ROOT). The server only reads and writes inside that folder.",
      "ROOT_REQUIRED",
    );
  }
  if (/^~([\\/]|$)/.test(root.trim()) || /^~[A-Za-z0-9._-]+([\\/]|$)/.test(root.trim())) {
    throw new UserError(
      `The root "${root}" starts with "~", which was not expanded by a shell (e.g. it was quoted or set in a JSON config). Use the full absolute path instead, e.g. /Users/you/Pictures/to-convert.`,
      "ROOT_TILDE",
    );
  }
  const allowedRoot = path.resolve(cwd, root);
  assertSafeRoot(allowedRoot, homes ?? [os.homedir(), env.HOME ?? "", env.USERPROFILE ?? ""]);
  return {
    allowedRoot,
    limits: {
      maxInputBytes: num(flags["max-input-mb"] ?? env.LOCAL_IMAGE_CONVERT_MAX_INPUT_MB, DEFAULT_LIMITS.maxInputBytes / 1048576, "max-input-mb") * 1048576,
      maxMegapixels: num(flags["max-megapixels"] ?? env.LOCAL_IMAGE_CONVERT_MAX_MEGAPIXELS, DEFAULT_LIMITS.maxMegapixels, "max-megapixels"),
      maxBatchFiles: Math.floor(num(flags["max-batch-files"] ?? env.LOCAL_IMAGE_CONVERT_MAX_BATCH_FILES, DEFAULT_LIMITS.maxBatchFiles, "max-batch-files")),
      heicEnabled: !(truthy(flags["no-heic"]) || truthy(env.LOCAL_IMAGE_CONVERT_NO_HEIC)),
    },
  };
}
