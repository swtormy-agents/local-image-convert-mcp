import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import sharp from "sharp";

export const FIXTURES = path.resolve(__dirname, "fixtures");

export async function tmpRoot(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "licm-")));
}

/** Small JPEG with EXIF (incl. a GPS-like IFD entry via exif option). */
export async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 30, channels: 3, background: "#3366cc" } })
    .withExif({ IFD0: { Copyright: "fixture", Artist: "test-artist" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 45/1 0/1" } })
    .jpeg()
    .toBuffer();
}

export async function pngRgba(): Promise<Buffer> {
  return sharp({ create: { width: 20, height: 10, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A tiny PNG whose header claims 50000x50000 pixels (2500 MP): a decompression-bomb shaped file. */
export function bombPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(50000, 0);
  ihdr.writeUInt32BE(50000, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(1000))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
