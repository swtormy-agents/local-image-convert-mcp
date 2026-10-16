# local-image-convert-mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server that converts images **on your own machine**. Your AI assistant can turn HEIC photos into JPEG, shrink PNGs to WebP or AVIF, or convert a whole folder into a zip, without uploading a single file.

> Status: pre-release (0.1.0). Not yet published to npm.

## Privacy promise

- **Nothing leaves your device.** The server makes no network requests at runtime (installing or launching via npx downloads the package from the npm registry). HEIC decoding uses a WebAssembly build of libheif that ships inside the npm package; nothing is downloaded on demand.
- **No telemetry, no analytics, no logs sent anywhere.** Diagnostics go only to stderr on your machine.
- **Metadata is stripped by default.** Images are auto-rotated, then EXIF data (camera, GPS location, timestamps) is removed from outputs. Pass `keepMetadata: true` to keep it.
- **Restricted file access.** The server only reads and writes inside one allowed root directory that you must set with `--root`; it refuses to start without one, and refuses a filesystem root (`/`, `C:\`), your home directory, or any folder that contains it (such as `/home` or `/Users`), and a root starting with an unexpanded `~` (as happens in JSON configs; use the full path); paths are compared after resolving symlinks. `..` traversal, drive-relative paths, NTFS alternate data streams, reserved Windows device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, CONIN$, CONOUT$) and symlinks that resolve outside the root are rejected. Right before and after each write the output folder is re-checked. If something swaps it for a link to another location, the write is refused; if the swap happens in the instant around opening the file, the file is emptied through its open handle and an `OUTPUT_DIR_CHANGED_FILE_LEFT` error is returned with its location (on Linux via `/proc/self/fd`; on macOS and Windows the location may be unknown). If a write fails for another reason, the file is emptied and `WRITE_FAILED_FILE_LEFT` is returned with its path. The server never deletes files on error paths, because a name can be swapped between any check and the delete; remove leftover empty files yourself. A batch ZIP is only created after the first image converts successfully. Do not point `--root` at a folder that untrusted programs can modify.
- **Never overwrites.** If `photo.webp` exists, the result is written as `photo-1.webp`.

## Tools

| Tool | What it does |
| --- | --- |
| `convert_image` | Convert one file. Inputs: `input` path, `format` (`jpeg`, `png`, `webp`, `avif`), `quality` 0.5–1.0 (default 0.85), optional `outputDir` (default: next to the input), `keepMetadata` (default false). |
| `batch_convert` | Convert a list of files (`inputs`) and/or a folder (`inputDir`, not recursive) into `outputDir`, as separate files or one `.zip` (streamed to disk one image at a time) (`zip: true`, optional `zipName` using only letters, digits, `.`, `_`, `-`). Bad files are reported and skipped. |

Supported inputs: JPEG, PNG, WebP, AVIF, GIF (first frame), TIFF, HEIC/HEIF.
Both tools are annotated `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: false`.

## Install

Requires Node.js 20 or newer.

```bash
npx -y local-image-convert-mcp --root ~/Pictures/convert
```

Until the package is published, run it from a clone:

```bash
git clone https://github.com/swtormy-agents/local-image-convert-mcp
cd local-image-convert-mcp && npm ci && npm run build
node dist/index.js --root ~/Pictures/convert
```

## Configure your MCP client

Most clients (Claude Desktop, Cursor, VS Code, and others) accept a JSON config like this:

```json
{
  "mcpServers": {
    "image-convert": {
      "command": "npx",
      "args": ["-y", "local-image-convert-mcp", "--root", "/Users/you/Pictures/convert"]
    }
  }
}
```

`--root` is required and should be an absolute path. MCP clients may start the server in an unexpected working directory. Alternatively set the environment variable `LOCAL_IMAGE_CONVERT_ROOT` (most clients accept an `"env"` object next to `"args"`).

### Options

| Flag | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--root <dir>` | `LOCAL_IMAGE_CONVERT_ROOT` | none (required) | The only directory the server may read from and write to. A filesystem root (`/`, `C:\`), your home directory and any folder that contains it (e.g. `/home`, `/Users`) are refused, as is a path starting with an unexpanded `~` (use a full path in JSON configs) |
| `--max-input-mb <n>` | `LOCAL_IMAGE_CONVERT_MAX_INPUT_MB` | 100 | Largest input file |
| `--max-megapixels <n>` | `LOCAL_IMAGE_CONVERT_MAX_MEGAPIXELS` | 100 | Largest decoded image (protects against decompression bombs) |
| `--max-batch-files <n>` | `LOCAL_IMAGE_CONVERT_MAX_BATCH_FILES` | 200 | Most files in one `batch_convert` call |
| `--no-heic` | `LOCAL_IMAGE_CONVERT_NO_HEIC=1` | off | Kill-switch: disable HEIC/HEIF decoding (libheif is then never loaded) |

## Errors

Errors explain what went wrong and what to do next, for example:
`Path "../secret.png" is outside the allowed root (/Users/you/Pictures). Use a path inside it, or restart the server with a different --root.`

## Development

```bash
npm ci
npm test   # builds, then runs unit tests and a stdio smoke test
```

## Website

A free in-browser converter by the same team: https://noclaudkit.com/

## Attribution and licences

This project is MIT-licensed. HEIC decoding uses **libheif** and **libde265** via the unmodified npm package `libheif-js` (LGPL-3.0), installed as a separate dependency you can replace. Raster processing uses **sharp** (Apache-2.0) with **libvips** (LGPL-3.0). HEVC/HEIC decoding only; this package never encodes HEVC or HEIC. HEVC may be covered by patents in some countries. No patent licence is granted by this project or its authors; you are responsible for any patent licences required where you use it. Full details, source links and licence texts: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [`licenses/`](licenses/).

## Disclaimer

This is an independent open-source project. Claude and Claude Desktop are trademarks of Anthropic, PBC. Cursor is a trademark of Anysphere, Inc. Visual Studio Code and VS Code are trademarks of Microsoft Corporation. All other names are trademarks of their respective owners and are used only to describe compatibility. Format names (HEIC, HEIF, WebP, AVIF, JPEG, PNG) are used descriptively. This project is not affiliated with, endorsed by, or sponsored by Anthropic, Anysphere, Microsoft or any other MCP client vendor. The software is provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).
