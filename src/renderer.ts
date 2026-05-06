import type { DrawGlyphFitOptions, BufferLike, Charset, ShapeVector } from "./types.ts"
import { sampleShapeVectorInto } from "./shape-vector.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"
import { BRAILLE } from "./charsets/braille.ts"
import { InvalidFieldError, InvalidOptionsError } from "./errors.ts"

const CODEPOINT_SPACE = 0x20

/* ────────────────────────────────────────────────────────────────────────── */
/*  Validation                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

interface NormalizedOptions {
  intensities: Float32Array
  srcWidth: number
  srcHeight: number
  destX: number
  destY: number
  destWidth: number
  destHeight: number
  charset: Charset
  gamma: number
  threshold: number
}

function normalizeOptions(buffer: BufferLike, opt: DrawGlyphFitOptions): NormalizedOptions {
  const { intensities, srcWidth, srcHeight, x: destX, y: destY } = opt
  const destWidth  = opt.destWidth  ?? buffer.width  - destX
  const destHeight = opt.destHeight ?? buffer.height - destY
  const charset    = opt.charset    ?? BRAILLE
  const gamma      = opt.gamma      ?? 1
  const threshold  = opt.threshold  ?? 0.02

  if (opt.unsafe) {
    return { intensities, srcWidth, srcHeight, destX, destY, destWidth, destHeight, charset, gamma, threshold }
  }

  if (!Number.isInteger(srcWidth) || srcWidth <= 0)
    throw new InvalidFieldError(`srcWidth must be a positive integer, got ${srcWidth}`)
  if (!Number.isInteger(srcHeight) || srcHeight <= 0)
    throw new InvalidFieldError(`srcHeight must be a positive integer, got ${srcHeight}`)
  if (intensities.length !== srcWidth * srcHeight)
    throw new InvalidFieldError(
      `intensities.length (${intensities.length}) does not match srcWidth*srcHeight (${srcWidth * srcHeight})`,
    )

  if (!Number.isInteger(destX))
    throw new InvalidOptionsError(`x must be an integer, got ${destX}`)
  if (!Number.isInteger(destY))
    throw new InvalidOptionsError(`y must be an integer, got ${destY}`)
  if (!Number.isInteger(destWidth) || destWidth < 0)
    throw new InvalidOptionsError(`destWidth must be a non-negative integer, got ${destWidth}`)
  if (!Number.isInteger(destHeight) || destHeight < 0)
    throw new InvalidOptionsError(`destHeight must be a non-negative integer, got ${destHeight}`)

  if (!Number.isFinite(gamma) || gamma <= 0)
    throw new InvalidOptionsError(`gamma must be a positive finite number, got ${gamma}`)
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new InvalidOptionsError(`threshold must be in [0, 1], got ${threshold}`)

  // Charset emptiness is also caught later by `compileCharset`, but we throw
  // the more specific message here so the stack trace points at the user call.
  if (charset.length === 0)
    throw new InvalidOptionsError("charset is empty")

  return { intensities, srcWidth, srcHeight, destX, destY, destWidth, destHeight, charset, gamma, threshold }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Cheap pre-pass: average the cell's source pixels for threshold gating     */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Single-bucket average of the cell's source region.
 * Cheaper than the full 6-bucket sample because it avoids the row/column
 * dispatch — useful as an early reject before the full sample.
 */
function cellMeanIntensity(
  intensities: Float32Array,
  srcWidth: number, srcHeight: number,
  cellX: number, cellY: number,
  destWidth: number, destHeight: number,
): number {
  const pxLeft   = (cellX / destWidth)  * srcWidth
  const pxRight  = ((cellX + 1) / destWidth)  * srcWidth
  const pyTop    = (cellY / destHeight) * srcHeight
  const pyBottom = ((cellY + 1) / destHeight) * srcHeight

  const ixStart = Math.max(0, Math.floor(pxLeft))
  const ixEnd   = Math.min(srcWidth - 1, Math.ceil(pxRight - 1))
  const iyStart = Math.max(0, Math.floor(pyTop))
  const iyEnd   = Math.min(srcHeight - 1, Math.ceil(pyBottom - 1))

  let sum = 0, count = 0
  for (let iy = iyStart; iy <= iyEnd; iy++) {
    const rowOffset = iy * srcWidth
    for (let ix = ixStart; ix <= ixEnd; ix++) {
      const v = intensities[rowOffset + ix]
      if (v !== undefined && Number.isFinite(v)) {
        sum += v
        count++
      }
    }
  }
  return count > 0 ? sum / count : 0
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public renderer                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Draw an intensity field into an OpenTUI `OptimizedBuffer` using
 * direction-aware character selection.
 *
 * Drop-in replacement for `buffer.drawGrayscaleBufferSupersampled`.
 *
 * The destination region is `destWidth × destHeight` cells anchored at
 * `(x, y)`. If `destWidth`/`destHeight` are omitted, the region fills from
 * `(x, y)` to the bottom-right of the buffer.
 *
 * @example
 * ```ts
 * import { drawGlyphFit, BLOCKS_SHADE } from "opentui-glyphfit"
 * import { RGBA } from "@opentui/core"
 *
 * drawGlyphFit(buffer, {
 *   intensities, srcWidth: 200, srcHeight: 80,
 *   x: 0, y: 0, destWidth: 100, destHeight: 40,
 *   fg: RGBA.fromValues(0.8, 0.9, 1.0, 1),
 *   bg: RGBA.fromValues(0,   0,   0,   1),
 *   charset: BLOCKS_SHADE,
 * })
 * ```
 */
export function drawGlyphFit(buffer: BufferLike, options: DrawGlyphFitOptions): void {
  const norm = normalizeOptions(buffer, options)
  const {
    intensities, srcWidth, srcHeight,
    destX, destY, destWidth, destHeight,
    charset, gamma, threshold,
  } = norm

  // Clamp the dest region against the buffer bounds.
  const startCellX = Math.max(0, destX)
  const startCellY = Math.max(0, destY)
  const endCellX   = Math.min(buffer.width,  destX + destWidth)
  const endCellY   = Math.min(buffer.height, destY + destHeight)

  if (startCellX >= endCellX || startCellY >= endCellY) return

  const compiled = compileCharset(charset)
  const sv: ShapeVector = [0, 0, 0, 0, 0, 0]  // reused per cell — no per-cell alloc.
  const fg = options.fg
  const bg = options.bg
  const intensityToFg = options.intensityToFg
  const sticky = options.sticky

  for (let cellY = startCellY; cellY < endCellY; cellY++) {
    for (let cellX = startCellX; cellX < endCellX; cellX++) {
      const localX = cellX - destX
      const localY = cellY - destY

      // Threshold-first: cheap mean before the full 6-bucket sample.
      // Skipping empty cells dominates real-world scenes.
      const mean = cellMeanIntensity(
        intensities, srcWidth, srcHeight,
        localX, localY, destWidth, destHeight,
      )
      if (mean < threshold) continue

      sampleShapeVectorInto(
        sv, intensities, srcWidth, srcHeight,
        localX, localY, destWidth, destHeight, gamma,
      )

      const codepoint = sticky !== undefined
        ? sticky.match(sv, localY * destWidth + localX, compiled)
        : compiled.codepoints[findBestCharIn(sv, compiled)]!

      const cellFg = intensityToFg !== undefined ? intensityToFg(mean, fg) : fg
      buffer.drawChar(codepoint, cellX, cellY, cellFg, bg)
    }
  }
}

/**
 * Render an intensity field to a flat array of ShapeVectors, one per cell,
 * row-major. Useful for inspection, snapshot tests, or piping into a custom
 * downstream pipeline.
 */
export function sampleField(
  intensities: Float32Array,
  srcWidth: number, srcHeight: number,
  destWidth: number, destHeight: number,
  gamma: number = 1,
): ShapeVector[] {
  const result: ShapeVector[] = new Array(destWidth * destHeight)
  for (let cellY = 0; cellY < destHeight; cellY++) {
    for (let cellX = 0; cellX < destWidth; cellX++) {
      const sv: ShapeVector = [0, 0, 0, 0, 0, 0]
      sampleShapeVectorInto(sv, intensities, srcWidth, srcHeight, cellX, cellY, destWidth, destHeight, gamma)
      result[cellY * destWidth + cellX] = sv
    }
  }
  return result
}

/**
 * Return the best-match codepoint for each cell as a flat array, row-major.
 * Useful for snapshot testing and CLI smoke tools.
 */
export function matchField(
  intensities: Float32Array,
  srcWidth: number, srcHeight: number,
  destWidth: number, destHeight: number,
  charset: Charset = BRAILLE,
  gamma: number = 1,
): number[] {
  if (charset.length === 0) {
    throw new InvalidOptionsError("charset is empty")
  }
  const compiled = compileCharset(charset)
  const sv: ShapeVector = [0, 0, 0, 0, 0, 0]
  const out: number[] = new Array(destWidth * destHeight)
  for (let cellY = 0; cellY < destHeight; cellY++) {
    for (let cellX = 0; cellX < destWidth; cellX++) {
      sampleShapeVectorInto(sv, intensities, srcWidth, srcHeight, cellX, cellY, destWidth, destHeight, gamma)
      const idx = findBestCharIn(sv, compiled)
      out[cellY * destWidth + cellX] = compiled.codepoints[idx]!
    }
  }
  return out
}

// Re-export for convenience.
export { CODEPOINT_SPACE }
