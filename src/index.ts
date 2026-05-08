// ─── Core types ───────────────────────────────────────────────────────────────
export type { ShapeVector, CharEntry, Charset, DrawGlyphFitOptions, BufferLike } from "./types.ts"

// ─── Errors ───────────────────────────────────────────────────────────────────
export {
  GlyphFitError,
  InvalidFieldError,
  InvalidCharsetError,
  InvalidOptionsError,
} from "./errors.ts"

// ─── ShapeVector primitives ───────────────────────────────────────────────────
export {
  svDistance,
  sampleShapeVector,
  sampleShapeVectorInto,
  findBestChar,
  buildCharsetFromEntries,
} from "./shape-vector.ts"

// ─── Compiled charset (typed-array hot-path representation) ───────────────────
export type { CompiledCharset } from "./compiled-charset.ts"
export { compileCharset, findBestCharIn } from "./compiled-charset.ts"

// ─── Built-in charsets ────────────────────────────────────────────────────────
export { BRAILLE } from "./charsets/braille.ts"
export { SHADE, BLOCKS, BLOCKS_SHADE } from "./charsets/blocks.ts"
export { BOX } from "./charsets/box.ts"
export { ASCII } from "./charsets/ascii.ts"
export { CANDLE, CANDLE_BOX, SPARK, DEPTH, AXIS } from "./charsets/chart.ts"

// ─── Renderers ────────────────────────────────────────────────────────────────
export { drawGlyphFit, sampleField, matchField } from "./renderer.ts"
export { drawGlyphFitColor } from "./color-renderer.ts"
export type { DrawGlyphFitColorOptions } from "./color-renderer.ts"
export { drawShapeCells } from "./shape-cells.ts"
export type { ShapeCellOp } from "./shape-cells.ts"
export { verticalFill, horizontalFill, verticalWick } from "./sv-builders.ts"

// ─── Palettes ────────────────────────────────────────────────────────────────
export {
  makePalette, paletteFromHex, paletteFromValues,
  samplePaletteInto, paletteFg,
  FIRE, OCEAN, SYNTHWAVE, PHOSPHOR, INFERNO, VIRIDIS, GRAYSCALE,
} from "./palette.ts"

// ─── Stickiness (frame-to-frame char hysteresis) ──────────────────────────────
export { StickyMatcher, makeStickyCompiled } from "./stickiness.ts"
export type { StickyMatcherOptions } from "./stickiness.ts"

// ─── Image → intensity ──────────────────────────────────────────────────────────
export { intensityFromPixels, resampleIntensity } from "./image.ts"
export type { IntensityFromPixelsOptions, LuminanceFormula } from "./image.ts"

// ─── Screenshot rendering (text / ANSI / HTML) ─────────────────────────────
export {
  renderToText, renderToAnsi, renderToHtml,
  renderToImagePixels, renderAllFormats,
} from "./screenshot.ts"
export type {
  RenderToHtmlOptions, RenderToImageOptions, RasterImage,
  SaveScreenshotResult,
} from "./screenshot.ts"

// ─── Lookup helpers ───────────────────────────────────────────────────────────
import { BRAILLE } from "./charsets/braille.ts"
import { SHADE, BLOCKS } from "./charsets/blocks.ts"
import { BOX } from "./charsets/box.ts"
import { ASCII } from "./charsets/ascii.ts"
import type { ShapeVector, Charset, CharEntry } from "./types.ts"
import { buildCharsetFromEntries } from "./shape-vector.ts"

/**
 * Lazy O(1) lookup table. Built on first call — keeps module-load cost down
 * and lets users tree-shake out the index module if they only need core APIs.
 */
let _shapeIndex: Map<number, ShapeVector> | null = null
function getShapeIndex(): Map<number, ShapeVector> {
  if (_shapeIndex !== null) return _shapeIndex
  const m = new Map<number, ShapeVector>()
  for (const cs of [BRAILLE, SHADE, BLOCKS, BOX, ASCII]) {
    for (const e of cs) {
      // First write wins; later duplicates (e.g. space across charsets) ignored.
      if (!m.has(e.codepoint)) m.set(e.codepoint, e.sv)
    }
  }
  _shapeIndex = m
  return m
}

/**
 * Return the ShapeVector for a known codepoint, or `undefined` if it is not
 * present in any built-in charset.
 *
 * @example
 * ```ts
 * shapeOf(0x2580)  // ▀ UPPER HALF BLOCK → [1, 1, 0.5, 0.5, 0, 0]
 * shapeOf(0x1F600) // → undefined
 * ```
 */
export function shapeOf(codepoint: number): ShapeVector | undefined {
  return getShapeIndex().get(codepoint)
}

/**
 * Build a custom Charset from an arbitrary list of entries.
 *
 * Each entry may be:
 *  - `number` — a codepoint already known to a built-in charset; its
 *               ShapeVector is looked up via `shapeOf`. Unknown codepoints
 *               are silently skipped.
 *  - `[codepoint, sv]` — an explicit (codepoint, ShapeVector) pair, used as-is.
 *               Lets you mix custom characters with built-ins.
 *
 * @example
 * ```ts
 * // 6 built-ins:
 * const a = buildCharset([0x2588, 0x2580, 0x2584, 0x258C, 0x2590, 0x20])
 *
 * // Mix built-ins with a custom char:
 * const b = buildCharset([
 *   0x2588,                                  // █ from blocks
 *   [0x2022, [0, 0, 0.6, 0.6, 0, 0]],        // • bullet, custom SV
 * ])
 * ```
 */
export function buildCharset(
  entries: ReadonlyArray<number | readonly [number, ShapeVector]>,
): Charset {
  const out: Array<[number, ShapeVector]> = []
  for (const entry of entries) {
    if (typeof entry === "number") {
      const sv = shapeOf(entry)
      if (sv !== undefined) out.push([entry, sv])
    } else {
      out.push([entry[0], entry[1]])
    }
  }
  return buildCharsetFromEntries(out)
}

/** Re-export to make a CharEntry import path consistent for downstreams. */
export type { CharEntry as CharsetEntry } from "./types.ts"
