# Third-party notices

This package (MIT) depends on the following components. They are **not bundled or modified**: npm installs them as separate packages, so you can replace any of them with your own build.

## libheif-js (LGPL-3.0) — HEIC decoding
- npm `libheif-js@1.23.5` (libheif 1.23.5 + libde265 1.0.15, compiled to WebAssembly), used unmodified via `require("libheif-js/wasm-bundle")`. It is loaded lazily, only when a HEIC/HEIF file is converted.
- Licence: [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt) together with [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt).
- Source: libheif https://github.com/strukturag/libheif/tree/v1.23.5 · libde265 https://github.com/strukturag/libde265/tree/v1.0.15 · libheif-js https://github.com/catdad-experiments/libheif-js/tree/1.23.5
- Replacing it: install a different build with `npm install libheif-js@<version>` (or `npm link` your own build) in the directory where this package is installed. This package only uses the public `HeifDecoder` API.
- HEVC/HEIC decoding only; this package never encodes HEVC or HEIC. HEVC may be covered by patents in some countries. No patent licence is granted by this project or its authors; you are responsible for any patent licences required where you use it.

## sharp (Apache-2.0) and libvips (LGPL-3.0)
- npm `sharp` (Apache-2.0). Its prebuilt native binaries come from the separate `@img/sharp-libvips-*` packages (libvips, LGPL-3.0, and other libraries listed in those packages). See https://sharp.pixelplumbing.com/install and the licence files inside `node_modules/@img/`.
- libvips is licensed under LGPL-3.0-or-later; the licence text is [`licenses/LGPL-3.0.txt`](licenses/LGPL-3.0.txt) together with [`licenses/GPL-3.0.txt`](licenses/GPL-3.0.txt).
- Source: libvips https://github.com/libvips/libvips · sharp-libvips (build scripts for the prebuilt binaries) https://github.com/lovell/sharp-libvips
- To use your own libvips, follow https://sharp.pixelplumbing.com/install#custom-libvips (globally-installed libvips) or replace the @img/sharp-libvips-* package.

## Other dependencies
- `@modelcontextprotocol/sdk` (MIT), `zod` (MIT), `yazl` (MIT).
