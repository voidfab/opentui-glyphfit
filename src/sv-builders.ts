import type { ShapeVector } from "./types.ts"

/**
 * Build a ShapeVector for ink filling rows `[fillTop, fillBottom]` of a
 * cell. Coordinates are fractional cell rows from the top.
 */
export function verticalFill(fillTop: number, fillBottom: number): ShapeVector {
  if (fillBottom <= fillTop) return [0, 0, 0, 0, 0, 0]
  const top = bandSample(fillTop, fillBottom, 0,     2 / 6)
  const mid = bandSample(fillTop, fillBottom, 2 / 6, 4 / 6)
  const bot = bandSample(fillTop, fillBottom, 4 / 6, 1)
  return [top, top, mid, mid, bot, bot]
}

/**
 * Build a ShapeVector for ink filling columns `[fillLeft, fillRight]` of a
 * cell. Same convention as `verticalFill`, but along the x axis.
 */
export function horizontalFill(fillLeft: number, fillRight: number): ShapeVector {
  if (fillRight <= fillLeft) return [0, 0, 0, 0, 0, 0]
  const left  = bandOverlap(fillLeft, fillRight, 0,   2 / 4)
  const right = bandOverlap(fillLeft, fillRight, 2 / 4, 1)
  return [left, right, left, right, left, right]
}

/**
 * Build a ShapeVector for a thin vertical line through the horizontal centre
 * of the cell, filling rows `[fillTop, fillBottom]`.
 */
export function verticalWick(fillTop: number, fillBottom: number): ShapeVector {
  if (fillBottom <= fillTop) return [0, 0, 0, 0, 0, 0]
  const top = bandOverlap(fillTop, fillBottom, 0,   2 / 6) * 0.5
  const mid = bandOverlap(fillTop, fillBottom, 2 / 6, 4 / 6) * 0.5
  const bot = bandOverlap(fillTop, fillBottom, 4 / 6, 1)   * 0.5
  return [top, top, mid, mid, bot, bot]
}

function bandOverlap(fillLo: number, fillHi: number, bandLo: number, bandHi: number): number {
  const lo = Math.max(fillLo, bandLo)
  const hi = Math.min(fillHi, bandHi)
  const overlap = Math.max(0, hi - lo)
  const bandWidth = bandHi - bandLo
  return bandWidth > 0 ? overlap / bandWidth : 0
}

function bandSample(fillLo: number, fillHi: number, bandLo: number, bandHi: number): number {
  const overlapLo = Math.max(fillLo, bandLo)
  const overlapHi = Math.min(fillHi, bandHi)
  const overlap = overlapHi - overlapLo
  if (overlap <= 0) return 0
  const bandWidth = bandHi - bandLo
  if (overlap >= bandWidth - 1e-9) return 1
  return 0.5
}
