import type { ShapeVector, CharEntry, Charset } from "./types.ts"
import { InvalidCharsetError } from "./errors.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"

/**
 * Squared Euclidean distance between two ShapeVectors in ℝ⁶.
 * Inlined and unrolled — this is the hot path during rendering. Returns the
 * squared distance to avoid a `Math.sqrt` call on every comparison; the
 * monotonic ordering is preserved.
 */
export function svDistance(a: ShapeVector, b: ShapeVector): number {
  const d0 = a[0] - b[0]
  const d1 = a[1] - b[1]
  const d2 = a[2] - b[2]
  const d3 = a[3] - b[3]
  const d4 = a[4] - b[4]
  const d5 = a[5] - b[5]
  return d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Sample a ShapeVector for one terminal cell, writing into a caller-provided
 * tuple to avoid per-cell allocation. Allocation-free hot path.
 *
 * Each source pixel contributes to all 6 sub-regions in proportion to its
 * area overlap with each region. This gives correct results even when the
 * cell spans only 2 source pixels vertically (the common 2× supersample case)
 * where naive integer-band assignment would leave the bottom row empty.
 *
 * Non-finite source values are treated as 0.
 *
 * @param out         - Mutated; 6 elements written.
 * @param intensities - Row-major Float32Array, values in [0, 1].
 * @param srcWidth    - Width of the source field in pixels (> 0).
 * @param srcHeight   - Height of the source field in pixels (> 0).
 * @param cellX       - Destination cell column (0-based).
 * @param cellY       - Destination cell row (0-based).
 * @param destWidth   - Width of the destination region in cells (> 0).
 * @param destHeight  - Height of the destination region in cells (> 0).
 * @param gamma       - Optional gamma exponent applied to each averaged sample.
 */
export function sampleShapeVectorInto(
  out: ShapeVector,
  intensities: Float32Array,
  srcWidth: number,
  srcHeight: number,
  cellX: number,
  cellY: number,
  destWidth: number,
  destHeight: number,
  gamma: number = 1,
): void {
  // Pixel bounds for this cell within the source field.
  const pxLeft   = (cellX / destWidth)  * srcWidth
  const pxRight  = ((cellX + 1) / destWidth)  * srcWidth
  const pyTop    = (cellY / destHeight) * srcHeight
  const pyBottom = ((cellY + 1) / destHeight) * srcHeight

  const pxMid       = (pxLeft + pxRight) / 2
  const pyHeight    = pyBottom - pyTop
  const pyRowMidUp  = pyTop + pyHeight / 3
  const pyRowMidLo  = pyTop + (2 * pyHeight) / 3

  // 6 area-weighted accumulators.
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0
  let c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0, c5 = 0

  const ixStart = Math.max(0, Math.floor(pxLeft))
  const ixEnd   = Math.min(srcWidth  - 1, Math.ceil(pxRight  - 1))
  const iyStart = Math.max(0, Math.floor(pyTop))
  const iyEnd   = Math.min(srcHeight - 1, Math.ceil(pyBottom - 1))

  for (let iy = iyStart; iy <= iyEnd; iy++) {
    // Vertical overlap of pixel row [iy, iy+1) with each of the 3 cell bands.
    const yLo = iy     > pyTop    ? iy     : pyTop
    const yHi = iy + 1 < pyBottom ? iy + 1 : pyBottom
    if (yHi <= yLo) continue

    const topHi = yHi < pyRowMidUp ? yHi : pyRowMidUp
    const wTop  = topHi > yLo ? topHi - yLo : 0

    const midLo = yLo > pyRowMidUp ? yLo : pyRowMidUp
    const midHi = yHi < pyRowMidLo ? yHi : pyRowMidLo
    const wMid  = midHi > midLo ? midHi - midLo : 0

    const botLo = yLo > pyRowMidLo ? yLo : pyRowMidLo
    const wBot  = yHi > botLo ? yHi - botLo : 0

    const rowOffset = iy * srcWidth

    for (let ix = ixStart; ix <= ixEnd; ix++) {
      // Horizontal overlap of pixel column [ix, ix+1) with left/right bands.
      const xLo = ix     > pxLeft  ? ix     : pxLeft
      const xHi = ix + 1 < pxRight ? ix + 1 : pxRight
      if (xHi <= xLo) continue

      const leftHi = xHi < pxMid ? xHi : pxMid
      const wLeft  = leftHi > xLo ? leftHi - xLo : 0
      const rightLo = xLo > pxMid ? xLo : pxMid
      const wRight = xHi > rightLo ? xHi - rightLo : 0

      const raw = intensities[rowOffset + ix]
      const v = raw !== undefined && Number.isFinite(raw) ? raw : 0

      const aTL = wTop * wLeft,  aTR = wTop * wRight
      const aML = wMid * wLeft,  aMR = wMid * wRight
      const aBL = wBot * wLeft,  aBR = wBot * wRight

      s0 += v * aTL; c0 += aTL
      s1 += v * aTR; c1 += aTR
      s2 += v * aML; c2 += aML
      s3 += v * aMR; c3 += aMR
      s4 += v * aBL; c4 += aBL
      s5 += v * aBR; c5 += aBR
    }
  }

  const a0 = c0 > 0 ? s0 / c0 : 0
  const a1 = c1 > 0 ? s1 / c1 : 0
  const a2 = c2 > 0 ? s2 / c2 : 0
  const a3 = c3 > 0 ? s3 / c3 : 0
  const a4 = c4 > 0 ? s4 / c4 : 0
  const a5 = c5 > 0 ? s5 / c5 : 0

  if (gamma === 1) {
    out[0] = clamp01(a0); out[1] = clamp01(a1)
    out[2] = clamp01(a2); out[3] = clamp01(a3)
    out[4] = clamp01(a4); out[5] = clamp01(a5)
  } else {
    out[0] = clamp01(Math.pow(a0, gamma))
    out[1] = clamp01(Math.pow(a1, gamma))
    out[2] = clamp01(Math.pow(a2, gamma))
    out[3] = clamp01(Math.pow(a3, gamma))
    out[4] = clamp01(Math.pow(a4, gamma))
    out[5] = clamp01(Math.pow(a5, gamma))
  }
}

/**
 * Allocating variant of `sampleShapeVectorInto`. Convenient for tests and
 * one-off use; in render loops prefer the `Into` variant with a reused tuple.
 */
export function sampleShapeVector(
  intensities: Float32Array,
  srcWidth: number,
  srcHeight: number,
  cellX: number,
  cellY: number,
  destWidth: number,
  destHeight: number,
  gamma: number = 1,
): ShapeVector {
  const out: ShapeVector = [0, 0, 0, 0, 0, 0]
  sampleShapeVectorInto(out, intensities, srcWidth, srcHeight, cellX, cellY, destWidth, destHeight, gamma)
  return out
}

/**
 * Find the charset entry whose ShapeVector is closest (Euclidean) to `query`.
 * Throws `InvalidCharsetError` if `charset` is empty.
 *
 * For repeated calls against the same charset, the underlying typed-array
 * representation is built once and cached on a WeakMap; subsequent calls cost
 * O(N · 6) FMA-friendly Float32Array reads.
 */
export function findBestChar(query: ShapeVector, charset: Charset): CharEntry {
  if (charset.length === 0) {
    throw new InvalidCharsetError("Charset is empty")
  }
  const compiled = compileCharset(charset)
  const idx = findBestCharIn(query, compiled)
  return charset[idx]!
}

/** Build a frozen Charset from an array of (codepoint, ShapeVector) pairs. */
export function buildCharsetFromEntries(entries: Array<[number, ShapeVector]>): Charset {
  return Object.freeze(
    entries.map(([codepoint, sv]) => Object.freeze({ codepoint, sv }))
  )
}
