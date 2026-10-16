export const OUTPUT_FORMATS = ["jpeg", "png", "webp", "avif"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const EXTENSIONS: Record<OutputFormat, string> = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif" };

export const INPUT_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tif", ".tiff", ".heic", ".heif"]);

const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);

/** True when the buffer looks like HEVC-coded HEIF (HEIC). AVIF is handled by sharp directly. */
export function isHeic(buf: Buffer): boolean {
  if (buf.length < 16 || buf.toString("latin1", 4, 8) !== "ftyp") return false;
  const boxSize = Math.min(buf.readUInt32BE(0), buf.length, 256);
  const brands = [buf.toString("latin1", 8, 12)];
  for (let o = 16; o + 4 <= boxSize; o += 4) brands.push(buf.toString("latin1", o, o + 4));
  if (brands.some((b) => HEVC_BRANDS.has(b))) return true;
  // Generic "mif1"/"msf1" without avif brand: treat as HEIC and let libheif decide.
  return brands.some((b) => b === "mif1" || b === "msf1") && !brands.some((b) => b === "avif" || b === "avis");
}
