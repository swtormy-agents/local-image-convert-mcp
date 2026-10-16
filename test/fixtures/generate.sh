#!/usr/bin/env bash
# Regenerates the synthetic test fixtures in this directory.
# Pixels are computed programmatically (gradients); no photos or third-party images are used.
# Requirements: python3 (stdlib only) and heif-enc from libheif with the x265 plugin
#   (Debian/Ubuntu: apt-get install libheif-examples libheif-plugin-x265).
set -euo pipefail
cd "$(dirname "$0")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

python3 - "$tmp" <<'PY'
import struct, sys, zlib
out = sys.argv[1]
def png(path, w, h, fn):
    raw = b"".join(b"\x00" + b"".join(bytes(fn(x, y, w, h)) for x in range(w)) for y in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    open(path, "wb").write(data)
png(f"{out}/a.png", 64, 48, lambda x, y, w, h: (x * 255 // (w - 1), y * 255 // (h - 1), 128))
# Left half red, right half blue: after a 90 degree clockwise rotation, red is on top.
png(f"{out}/c.png", 64, 48, lambda x, y, w, h: (255, 0, 0) if x < w // 2 else (0, 0, 255))
png(f"{out}/b.png", 64, 48, lambda x, y, w, h: (200, x * 255 // (w - 1), 255 - y * 255 // (h - 1)))
PY

# Single-image HEIC, 64x48.
heif-enc -q 50 -o tiny.heic "$tmp/a.png"
# HEIC container with two top-level images, 64x48 each.
heif-enc -q 50 -o multi.heic "$tmp/a.png" "$tmp/b.png"
# 64x48 pixels stored with an 'irot' (rotate 90 deg clockwise) property: displays as 48x64, red on top.
heif-enc -q 50 --rotate-cw 90 -o rotated.heic "$tmp/c.png"
echo "Generated with: heif-enc $(heif-enc --version 2>&1 | head -1) / $(heif-enc --list-encoders 2>&1 | grep -m1 x265 | sed 's/^ *- //')"
ls -l tiny.heic multi.heic rotated.heic
