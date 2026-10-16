import { createRequire } from "node:module";
import { UserError } from "./errors.js";

/**
 * HEIC decoding via libheif-js (LGPL-3.0), used unmodified as a separate npm
 * dependency and loaded lazily only when a HEIC file is converted.
 * The "wasm-bundle" entry embeds the .wasm, so nothing is fetched over the network.
 */
type Libheif = { HeifDecoder: new () => { decode(buf: Uint8Array): HeifImage[] } };
interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: unknown) => void): void;
  free?: () => void;
}

let lib: Libheif | undefined;
function load(): Libheif {
  if (!lib) {
    const require = createRequire(import.meta.url);
    lib = require("libheif-js/wasm-bundle") as Libheif;
  }
  return lib;
}

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: 4;
}

/** Decode the primary (first) image of a HEIC file to RGBA, enforcing the megapixel limit before pixel decoding. */
export async function decodeHeic(buf: Buffer, maxMegapixels: number): Promise<RawImage> {
  let images: HeifImage[];
  try {
    const { HeifDecoder } = load();
    images = new HeifDecoder().decode(buf);
  } catch (e) {
    throw new UserError(`Could not parse HEIC file: ${(e as Error).message}. The file may be corrupt or not a HEIC image.`, "HEIC_DECODE_FAILED");
  }
  if (!images || images.length === 0) {
    throw new UserError("HEIC file contains no decodable image. It may be corrupt or use an unsupported codec.", "HEIC_EMPTY");
  }
  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  checkPixels(width, height, maxMegapixels);
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    img.display({ data, width, height }, (d) => (d ? resolve() : reject(new UserError("HEIC pixel decoding failed. The file may be corrupt.", "HEIC_DECODE_FAILED"))));
  });
  for (const i of images) i.free?.();
  return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height, channels: 4 };
}

export function checkPixels(width: number, height: number, maxMegapixels: number): void {
  const mp = (width * height) / 1e6;
  if (!Number.isFinite(mp) || width <= 0 || height <= 0) {
    throw new UserError("Image has invalid dimensions.", "BAD_DIMENSIONS");
  }
  if (mp > maxMegapixels) {
    throw new UserError(
      `Image is ${width}x${height} (${mp.toFixed(1)} MP), above the limit of ${maxMegapixels} MP. Raise --max-megapixels if you trust this file.`,
      "TOO_MANY_PIXELS",
    );
  }
}
