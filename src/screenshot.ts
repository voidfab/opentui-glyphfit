/**
 * Render a `DrawGlyphFitOptions` payload to a string instead of a buffer.
 *
 * Three output formats are provided. All three share the same matching
 * pipeline as `drawGlyphFit`, so the captured output is faithful to what the
 * live renderer produces — just minus any external state (dirty trackers,
 * sticky matchers, etc.).
 *
 *   - `renderToText`  → plain UTF-8, one row per line. No colour.
 *   - `renderToAnsi`  → 24-bit ANSI colour escapes. `cat` the result back
 *                       into any modern terminal to view.
 *   - `renderToHtml`  → standalone HTML wrapping each cell in a `<span>`
 *                       with inline styles. Loads in any browser.
 *
 * `sticky` is intentionally NOT honoured here: capture should be a pure
 * function of the inputs, not mutate the caller's matcher state.
 */

import type { RGBA } from "@opentui/core"
import type { DrawGlyphFitOptions } from "./types.ts"
import { sampleShapeVectorInto } from "./shape-vector.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"
import { BRAILLE } from "./charsets/braille.ts"
import { InvalidFieldError, InvalidOptionsError } from "./errors.ts"
import { rasterizeCell } from "./raster.ts"

type CaptureOptions = Omit<DrawGlyphFitOptions, "x" | "y" | "destWidth" | "destHeight" | "sticky" | "unsafe"> & {
  /** Destination region width in cells. Required (no default buffer to fall back to). */
  destWidth: number
  /** Destination region height in cells. Required. */
  destHeight: number
}

interface ResolvedCells {
  /** Codepoints, row-major. Length = destWidth × destHeight. */
  codepoints: Uint32Array
  /** Per-cell mean intensity (0 = empty / below threshold). */
  means: Float32Array
  /** Per-cell foreground colour (palette-modulated if intensityToFg was set). */
  fgs: Array<RGBA | null>
  destWidth: number
  destHeight: number
}

function resolveCells(options: CaptureOptions): ResolvedCells {
  const { intensities, srcWidth, srcHeight, destWidth, destHeight } = options
  const charset   = options.charset   ?? BRAILLE
  const gamma     = options.gamma     ?? 1
  const threshold = options.threshold ?? 0.02

  if (!Number.isInteger(srcWidth)  || srcWidth  <= 0) throw new InvalidFieldError(`srcWidth must be > 0, got ${srcWidth}`)
  if (!Number.isInteger(srcHeight) || srcHeight <= 0) throw new InvalidFieldError(`srcHeight must be > 0, got ${srcHeight}`)
  if (!Number.isInteger(destWidth)  || destWidth  <= 0) throw new InvalidOptionsError(`destWidth must be > 0, got ${destWidth}`)
  if (!Number.isInteger(destHeight) || destHeight <= 0) throw new InvalidOptionsError(`destHeight must be > 0, got ${destHeight}`)
  if (intensities.length !== srcWidth * srcHeight) {
    throw new InvalidFieldError(
      `intensities.length (${intensities.length}) does not match srcWidth*srcHeight (${srcWidth * srcHeight})`,
    )
  }
  if (charset.length === 0) throw new InvalidOptionsError("charset is empty")

  const compiled = compileCharset(charset)
  const sv: import("./types.ts").ShapeVector = [0, 0, 0, 0, 0, 0]
  const intensityToFg = options.intensityToFg

  const total = destWidth * destHeight
  const codepoints = new Uint32Array(total)
  const means = new Float32Array(total)
  const fgs: Array<RGBA | null> = new Array(total).fill(null)
  // Space codepoint marks "skipped / below threshold" cells.
  codepoints.fill(0x20)

  for (let cy = 0; cy < destHeight; cy++) {
    for (let cx = 0; cx < destWidth; cx++) {
      // Cheap pre-pass: compute mean for threshold gate.
      let pxLeft   = (cx / destWidth)  * srcWidth
      let pxRight  = ((cx + 1) / destWidth)  * srcWidth
      let pyTop    = (cy / destHeight) * srcHeight
      let pyBottom = ((cy + 1) / destHeight) * srcHeight
      let ixStart = Math.max(0, Math.floor(pxLeft))
      let ixEnd   = Math.min(srcWidth - 1, Math.ceil(pxRight - 1))
      let iyStart = Math.max(0, Math.floor(pyTop))
      let iyEnd   = Math.min(srcHeight - 1, Math.ceil(pyBottom - 1))
      let sum = 0, count = 0
      for (let iy = iyStart; iy <= iyEnd; iy++) {
        const row = iy * srcWidth
        for (let ix = ixStart; ix <= ixEnd; ix++) {
          const v = intensities[row + ix]
          if (v !== undefined && Number.isFinite(v)) { sum += v; count++ }
        }
      }
      const mean = count > 0 ? sum / count : 0
      const idx  = cy * destWidth + cx
      means[idx] = mean
      if (mean < threshold) continue

      sampleShapeVectorInto(sv, intensities, srcWidth, srcHeight, cx, cy, destWidth, destHeight, gamma)
      const matchIdx = findBestCharIn(sv, compiled)
      codepoints[idx] = compiled.codepoints[matchIdx]!

      if (intensityToFg !== undefined) {
        // intensityToFg may return a shared scratch RGBA — clone the values
        // so per-cell results don't all alias the same instance.
        const c = intensityToFg(mean, options.fg)
        fgs[idx] = { r: c.r, g: c.g, b: c.b, a: c.a } as unknown as RGBA
      }
    }
  }

  return { codepoints, means, fgs, destWidth, destHeight }
}

/* ─── renderToText ───────────────────────────────────────────────────── */

/**
 * Render the cell grid to a plain UTF-8 string, one terminal row per line,
 * with a trailing newline. Below-threshold cells become spaces.
 *
 * @example
 * ```ts
 * import { renderToText } from "opentui-glyphfit"
 * import { writeFileSync } from "node:fs"
 *
 * writeFileSync("art.txt", renderToText({
 *   intensities, srcWidth, srcHeight,
 *   destWidth: 80, destHeight: 24,
 *   fg: WHITE, bg: BLACK, charset: BLOCKS_SHADE,
 * }))
 * ```
 */
export function renderToText(options: CaptureOptions): string {
  const { codepoints, destWidth, destHeight } = resolveCells(options)
  const out: string[] = new Array(destHeight)
  for (let cy = 0; cy < destHeight; cy++) {
    let line = ""
    for (let cx = 0; cx < destWidth; cx++) line += String.fromCodePoint(codepoints[cy * destWidth + cx]!)
    out[cy] = line
  }
  return out.join("\n") + "\n"
}

/* ─── renderToAnsi ───────────────────────────────────────────────────── */

function rgba255(c: { r: number; g: number; b: number }): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(c.r * 255))),
    Math.max(0, Math.min(255, Math.round(c.g * 255))),
    Math.max(0, Math.min(255, Math.round(c.b * 255))),
  ]
}

/**
 * Render to a string of ANSI-coloured cells using 24-bit (truecolor) escapes.
 * `cat`-able into any modern terminal to view. Includes a final reset escape.
 *
 * @example
 * ```ts
 * writeFileSync("art.ansi.txt", renderToAnsi(opts))
 * // then in another terminal: cat art.ansi.txt
 * ```
 */
export function renderToAnsi(options: CaptureOptions): string {
  const { codepoints, fgs, destWidth, destHeight } = resolveCells(options)
  const [bgR, bgG, bgB] = rgba255(options.bg)
  const [defaultFgR, defaultFgG, defaultFgB] = rgba255(options.fg)

  let out = ""
  for (let cy = 0; cy < destHeight; cy++) {
    let prevFgR = -1, prevFgG = -1, prevFgB = -1
    let prevBg = false
    for (let cx = 0; cx < destWidth; cx++) {
      const idx = cy * destWidth + cx
      const cp = codepoints[idx]!
      const f = fgs[idx]
      const [fR, fG, fB] = f ? rgba255(f) : [defaultFgR, defaultFgG, defaultFgB]

      if (fR !== prevFgR || fG !== prevFgG || fB !== prevFgB) {
        out += `\x1b[38;2;${fR};${fG};${fB}m`
        prevFgR = fR; prevFgG = fG; prevFgB = fB
      }
      if (!prevBg) {
        out += `\x1b[48;2;${bgR};${bgG};${bgB}m`
        prevBg = true
      }
      out += String.fromCodePoint(cp)
    }
    out += "\x1b[0m\n"
  }
  return out
}

/* ─── renderToHtml ───────────────────────────────────────────────────── */

export interface RenderToHtmlOptions {
  /** Document title. Defaults to "opentui-glyphfit screenshot". */
  title?: string
  /** CSS font-family stack. Defaults to a reasonable monospace cascade. */
  fontFamily?: string
  /** Font size CSS value (e.g. "14px", "0.9em"). Defaults to "14px". */
  fontSize?: string
  /** Line-height CSS value. Defaults to "1.0" so terminal grids stay rectangular. */
  lineHeight?: string
}

const DEFAULT_FONT_FAMILY =
  `"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", Menlo, ` +
  `"DejaVu Sans Mono", "Liberation Mono", monospace`

function escapeHtml(cp: number): string {
  switch (cp) {
    case 0x26: return "&amp;"
    case 0x3C: return "&lt;"
    case 0x3E: return "&gt;"
    case 0x22: return "&quot;"
    case 0x27: return "&#39;"
    default:   return String.fromCodePoint(cp)
  }
}

/**
 * Render to a complete standalone HTML document. Each cell is a `<span>`
 * with inline styles inside a single `<pre>`. Drop the file into any
 * browser to view; the page's background and font come from the document
 * head so screenshots look identical regardless of the viewer.
 */
export function renderToHtml(options: CaptureOptions, html: RenderToHtmlOptions = {}): string {
  const { codepoints, fgs, destWidth, destHeight } = resolveCells(options)
  const [bgR, bgG, bgB] = rgba255(options.bg)
  const [defaultFgR, defaultFgG, defaultFgB] = rgba255(options.fg)

  const title      = html.title      ?? "opentui-glyphfit screenshot"
  const fontFamily = html.fontFamily ?? DEFAULT_FONT_FAMILY
  const fontSize   = html.fontSize   ?? "14px"
  const lineHeight = html.lineHeight ?? "1.0"

  const rows: string[] = new Array(destHeight)
  for (let cy = 0; cy < destHeight; cy++) {
    let line = ""
    let runFg = ""
    let runText = ""
    const flush = () => { if (runText) line += `<span style="color:${runFg}">${runText}</span>`; runText = "" }

    for (let cx = 0; cx < destWidth; cx++) {
      const idx = cy * destWidth + cx
      const cp = codepoints[idx]!
      const f = fgs[idx]
      const [fR, fG, fB] = f ? rgba255(f) : [defaultFgR, defaultFgG, defaultFgB]
      const colorCss = `rgb(${fR},${fG},${fB})`
      if (colorCss !== runFg) {
        flush()
        runFg = colorCss
      }
      runText += escapeHtml(cp)
    }
    flush()
    rows[cy] = line || " "
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtmlString(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: rgb(${bgR},${bgG},${bgB}); }
  pre {
    font-family: ${fontFamily};
    font-size: ${fontSize};
    line-height: ${lineHeight};
    color: rgb(${defaultFgR},${defaultFgG},${defaultFgB});
    background: rgb(${bgR},${bgG},${bgB});
    padding: 1.5em;
    margin: 0;
    white-space: pre;
    letter-spacing: 0;
  }
  pre span { white-space: pre; }
</style>
</head>
<body>
<pre>${rows.join("\n")}</pre>
</body>
</html>
`
}

function escapeHtmlString(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

/* ─── Convenience: write all three formats in one call ────────────────── */

export interface RenderToImageOptions {
  /** Pixels per cell, horizontal. Default 16. */
  cellWidth?: number
  /** Pixels per cell, vertical. Default 32 (terminal-typical 2:1 aspect). */
  cellHeight?: number
}

export interface RasterImage {
  /** Row-major RGBA bytes, length = width * height * 4. */
  rgba: Uint8Array
  width: number
  height: number
}

function rgba255FromRGBA(c: RGBA): [number, number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(c.r * 255))),
    Math.max(0, Math.min(255, Math.round(c.g * 255))),
    Math.max(0, Math.min(255, Math.round(c.b * 255))),
    Math.max(0, Math.min(255, Math.round(c.a * 255))),
  ]
}

/**
 * Rasterise the rendered cell grid into a flat `Uint8Array` of RGBA bytes
 * at the given cell pixel size. Suitable for piping into any PNG encoder
 * (pngjs, sharp, browser `ImageData`, etc.).
 *
 * Block / shade / braille / box characters rasterise analytically from their
 * geometric definitions — crisp at any size. ASCII characters fall back to
 * a directional 2x3 ShapeVector fill so the output stays font-free.
 *
 * @example
 * ```ts
 * import { renderToImagePixels } from "opentui-glyphfit"
 * import { PNG } from "pngjs"
 * import { writeFileSync } from "node:fs"
 *
 * const img = renderToImagePixels({
 *   intensities, srcWidth, srcHeight,
 *   destWidth: 200, destHeight: 60,
 *   fg: WHITE, bg: BLACK, charset: BLOCKS_SHADE,
 *   cellWidth: 12, cellHeight: 24,    // -> 2400x1440 image
 * })
 * const png = new PNG({ width: img.width, height: img.height })
 * png.data = Buffer.from(img.rgba)
 * writeFileSync("wallpaper.png", PNG.sync.write(png))
 * ```
 */
export function renderToImagePixels(
  options: CaptureOptions & RenderToImageOptions,
): RasterImage {
  const cw = options.cellWidth  ?? 16
  const ch = options.cellHeight ?? 32
  if (!Number.isInteger(cw) || cw <= 0) throw new InvalidOptionsError(`cellWidth must be > 0, got ${cw}`)
  if (!Number.isInteger(ch) || ch <= 0) throw new InvalidOptionsError(`cellHeight must be > 0, got ${ch}`)

  const cells = resolveCells(options)
  const { codepoints, means, fgs, destWidth, destHeight } = cells

  const width  = destWidth  * cw
  const height = destHeight * ch
  const rgba = new Uint8Array(width * height * 4)

  const bg255 = rgba255FromRGBA(options.bg)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i]     = bg255[0]
    rgba[i + 1] = bg255[1]
    rgba[i + 2] = bg255[2]
    rgba[i + 3] = bg255[3]
  }

  const defaultFg255 = rgba255FromRGBA(options.fg)
  const threshold = options.threshold ?? 0.02

  for (let cy = 0; cy < destHeight; cy++) {
    for (let cx = 0; cx < destWidth; cx++) {
      const idx = cy * destWidth + cx
      const cp  = codepoints[idx]!
      if (cp === 0x20 || means[idx]! < threshold) continue

      const fgPerCell = fgs[idx]
      const fg255 = fgPerCell ? rgba255FromRGBA(fgPerCell) : defaultFg255

      rasterizeCell(rgba, width, height, cx * cw, cy * ch, cw, ch, cp, fg255, bg255)
    }
  }

  return { rgba, width, height }
}

export interface SaveScreenshotResult {
  txt: string
  ansi: string
  html: string
}

/**
 * Render `options` to all three formats and return them. The caller is
 * responsible for writing them to disk. Convenient for demos with a "save
 * screenshot" hotkey.
 *
 * @example
 * ```ts
 * import { writeFileSync } from "node:fs"
 * import { renderAllFormats } from "opentui-glyphfit"
 *
 * const out = renderAllFormats({ ... })
 * writeFileSync("frame.txt",  out.txt)
 * writeFileSync("frame.ansi", out.ansi)
 * writeFileSync("frame.html", out.html)
 * ```
 */
export function renderAllFormats(
  options: CaptureOptions,
  htmlOptions?: RenderToHtmlOptions,
): SaveScreenshotResult {
  return {
    txt: renderToText(options),
    ansi: renderToAnsi(options),
    html: renderToHtml(options, htmlOptions),
  }
}
