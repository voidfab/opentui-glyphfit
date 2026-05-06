import type { BufferLike, Charset, ShapeVector } from "./types.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"
import { BLOCKS } from "./charsets/blocks.ts"
import { InvalidFieldError, InvalidOptionsError } from "./errors.ts"
import { RGBA } from "@opentui/core"

/**
 * Options for `drawGlyphFitColor`.
 *
 * Like `drawGlyphFit`, but operates on an RGBA source field. For each cell:
 *   1. Find the two cluster centroids of the cell's source pixels (k-means, k=2).
 *   2. Treat the brighter cluster as foreground, darker as background.
 *   3. Build a binary ShapeVector from "which cluster does each sample point
 *      belong to" — this is the directional information.
 *   4. Match the binary SV against `charset` to pick a directional character.
 *   5. drawChar(cp, x, y, fg, bg).
 *
 * This is the architectural fix for the "stripes on smooth surfaces" problem:
 * even when intensity is uniform across a face, colour rarely is — and the
 * fg/bg assignment captures that variation, so adjacent cells differ even when
 * their brightness is identical.
 */
export interface DrawGlyphFitColorOptions {
  /** Source field, row-major. Length = `srcWidth * srcHeight * 4`. RGBA in [0,1]. */
  rgba: Float32Array

  /** Width of the source field in pixels (> 0). */
  srcWidth: number
  /** Height of the source field in pixels (> 0). */
  srcHeight: number

  /** Destination cell anchor. */
  x: number
  y: number

  /** Width of the destination region in cells. Defaults to `buffer.width - x`. */
  destWidth?: number
  /** Height of the destination region in cells. Defaults to `buffer.height - y`. */
  destHeight?: number

  /**
   * Charset for directional matching. Defaults to `BLOCKS` because its
   * binary-coverage shape vectors map naturally to fg/bg partitions.
   */
  charset?: Charset

  /**
   * Background to use when a cell has no significant ink (mean luminance
   * below `threshold`). Defaults to opaque black.
   */
  emptyBg?: RGBA

  /** Skip cells whose mean luminance is below this. Defaults to 0.02. */
  threshold?: number

  /** Skip input validation. Default false. */
  unsafe?: boolean
}

/* ────────────────────────────────────────────────────────────────────────── */

const SAMPLE_X = [0.25, 0.75, 0.25, 0.75, 0.25, 0.75]
const SAMPLE_Y = [1 / 6, 1 / 6, 3 / 6, 3 / 6, 5 / 6, 5 / 6]

/** Rec.709 luminance of a non-premultiplied RGBA tuple. */
function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Draw an RGBA intensity field with direction-aware char + colour pair.
 *
 * @example
 * ```ts
 * import { drawGlyphFitColor, BLOCKS } from "opentui-glyphfit"
 *
 * drawGlyphFitColor(buffer, {
 *   rgba: rgbaField,            // Float32Array of length W*H*4
 *   srcWidth: W, srcHeight: H,
 *   x: 0, y: 0,
 *   charset: BLOCKS,
 * })
 * ```
 */
export function drawGlyphFitColor(buffer: BufferLike, options: DrawGlyphFitColorOptions): void {
  const { rgba, srcWidth, srcHeight, x: destX, y: destY } = options
  const destWidth  = options.destWidth  ?? buffer.width  - destX
  const destHeight = options.destHeight ?? buffer.height - destY
  const charset    = options.charset    ?? BLOCKS
  const threshold  = options.threshold  ?? 0.02
  const emptyBg    = options.emptyBg    ?? RGBA.fromValues(0, 0, 0, 1)

  if (!options.unsafe) {
    if (!Number.isInteger(srcWidth) || srcWidth <= 0)
      throw new InvalidFieldError(`srcWidth must be a positive integer, got ${srcWidth}`)
    if (!Number.isInteger(srcHeight) || srcHeight <= 0)
      throw new InvalidFieldError(`srcHeight must be a positive integer, got ${srcHeight}`)
    if (rgba.length !== srcWidth * srcHeight * 4)
      throw new InvalidFieldError(
        `rgba.length (${rgba.length}) does not match srcWidth*srcHeight*4 (${srcWidth * srcHeight * 4})`,
      )
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
      throw new InvalidOptionsError(`threshold must be in [0, 1], got ${threshold}`)
    if (charset.length === 0)
      throw new InvalidOptionsError("charset is empty")
  }

  const startCellX = Math.max(0, destX)
  const startCellY = Math.max(0, destY)
  const endCellX   = Math.min(buffer.width,  destX + destWidth)
  const endCellY   = Math.min(buffer.height, destY + destHeight)
  if (startCellX >= endCellX || startCellY >= endCellY) return

  const compiled = compileCharset(charset)
  const sv: ShapeVector = [0, 0, 0, 0, 0, 0]

  for (let cellY = startCellY; cellY < endCellY; cellY++) {
    for (let cellX = startCellX; cellX < endCellX; cellX++) {
      const localX = cellX - destX
      const localY = cellY - destY

      const pxLeft   = (localX / destWidth)  * srcWidth
      const pxRight  = ((localX + 1) / destWidth)  * srcWidth
      const pyTop    = (localY / destHeight) * srcHeight
      const pyBottom = ((localY + 1) / destHeight) * srcHeight

      const ixStart = Math.max(0, Math.floor(pxLeft))
      const ixEnd   = Math.min(srcWidth - 1, Math.ceil(pxRight - 1))
      const iyStart = Math.max(0, Math.floor(pyTop))
      const iyEnd   = Math.min(srcHeight - 1, Math.ceil(pyBottom - 1))

      // Pass 1: compute pixel range, mean luminance, find min/max-luminance pixel.
      let lumMin = Infinity, lumMax = -Infinity
      let lumMinIdx = -1, lumMaxIdx = -1
      let lumSum = 0, count = 0

      for (let iy = iyStart; iy <= iyEnd; iy++) {
        const rowOffset = iy * srcWidth
        for (let ix = ixStart; ix <= ixEnd; ix++) {
          const i = (rowOffset + ix) * 4
          const r = rgba[i]!, g = rgba[i + 1]!, b = rgba[i + 2]!
          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue
          const L = lum(r, g, b)
          lumSum += L
          count++
          if (L < lumMin) { lumMin = L; lumMinIdx = i }
          if (L > lumMax) { lumMax = L; lumMaxIdx = i }
        }
      }

      if (count === 0 || lumSum / count < threshold) {
        // Cell is empty — write the background colour directly so we erase
        // any stale glyph from a previous frame.
        buffer.drawChar(0x20, cellX, cellY, emptyBg, emptyBg)
        continue
      }

      // 1-iteration k-means (k=2): use min/max-luminance pixels as seeds.
      // For most natural scenes a single iteration is within a couple of
      // percent of the converged answer and avoids per-cell branching cost.
      const fgR = rgba[lumMaxIdx]!,     fgG = rgba[lumMaxIdx + 1]!, fgB = rgba[lumMaxIdx + 2]!
      const bgR = rgba[lumMinIdx]!,     bgG = rgba[lumMinIdx + 1]!, bgB = rgba[lumMinIdx + 2]!
      const lumThresh = (lumMin + lumMax) / 2

      // Pass 2: build the binary ShapeVector by sampling at the 6 sub-cell
      // points; each sample is "1 if its source pixel's luminance >= midpoint".
      const cellW = pxRight - pxLeft
      const cellH = pyBottom - pyTop
      for (let k = 0; k < 6; k++) {
        const sx = pxLeft + cellW * SAMPLE_X[k]!
        const sy = pyTop  + cellH * SAMPLE_Y[k]!
        let ix = Math.max(ixStart, Math.min(ixEnd, Math.floor(sx)))
        let iy = Math.max(iyStart, Math.min(iyEnd, Math.floor(sy)))
        const i = (iy * srcWidth + ix) * 4
        const L = lum(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
        sv[k as 0 | 1 | 2 | 3 | 4 | 5] = L >= lumThresh ? 1 : 0
      }

      const idx = findBestCharIn(sv, compiled)
      const codepoint = compiled.codepoints[idx]!

      const fg = RGBA.fromValues(fgR, fgG, fgB, 1)
      const bg = RGBA.fromValues(bgR, bgG, bgB, 1)
      buffer.drawChar(codepoint, cellX, cellY, fg, bg)
    }
  }
}
