/**
 * Box drawing charset — Unicode box-drawing characters (U+2500–U+257F).
 *
 * Shape vectors are derived from the geometric structure of each character:
 * - Horizontal lines: ink at y ≈ ½, spanning full width  → strong mid-row signal
 * - Vertical lines:   ink at x ≈ ½, spanning full height → equal left+right, all rows
 * - Corners/T-junctions: union of their constituent line segments
 *
 * The sample points (left=1/4, right=3/4, top=1/6, mid=3/6, bot=5/6) are not
 * directly on the centreline of thin box characters, so lines are approximated
 * with coverage values reflecting how close the sample point is to the ink.
 *
 * Horizontal line mid-row weight: 0.7 (sample at y=1/2 is on or near the line)
 * Vertical line column weight:    0.5 (sample at x=1/4 or 3/4 is off-centre from x=1/2)
 */

import type { Charset, ShapeVector } from "../types.ts"
import { buildCharsetFromEntries } from "../shape-vector.ts"

// Primitive line contributions to each ShapeVector component
// A horizontal line at the cell midpoint:
const H: ShapeVector = [0, 0, 0.7, 0.7, 0, 0]
// A vertical line through the cell centre:
const V: ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]

// Double-horizontal (two lines, one in upper third, one in lower third):
const HH: ShapeVector = [0.5, 0.5, 0, 0, 0.5, 0.5]
// Double-vertical (two lines, left and right of centre):
const VV: ShapeVector = [0.6, 0.6, 0.6, 0.6, 0.6, 0.6]

/** Combine two ShapeVectors by taking the max at each component (union of ink). */
function union(a: ShapeVector, b: ShapeVector): ShapeVector {
  return [
    Math.min(1, a[0] + b[0]),
    Math.min(1, a[1] + b[1]),
    Math.min(1, a[2] + b[2]),
    Math.min(1, a[3] + b[3]),
    Math.min(1, a[4] + b[4]),
    Math.min(1, a[5] + b[5]),
  ]
}

// Directional half-line segments (from centre to edge)
// Used to compose corners and T-junctions.
const H_LEFT:  ShapeVector = [0, 0, 0.7, 0,   0, 0]   // ─ extends left from centre
const H_RIGHT: ShapeVector = [0, 0, 0,   0.7, 0, 0]   // ─ extends right from centre
const V_UP:    ShapeVector = [0.5, 0.5, 0, 0, 0, 0]   // │ extends up from centre
const V_DOWN:  ShapeVector = [0, 0, 0, 0, 0.5, 0.5]   // │ extends down from centre

const BOX_ENTRIES: Array<[number, ShapeVector]> = [
  // ── Thin lines ────────────────────────────────────────────────────────────
  [0x2500, H],                            // ─ LIGHT HORIZONTAL
  [0x2502, V],                            // │ LIGHT VERTICAL
  [0x2550, HH],                           // ═ DOUBLE HORIZONTAL
  [0x2551, VV],                           // ║ DOUBLE VERTICAL

  // ── Thin corners ──────────────────────────────────────────────────────────
  [0x250C, union(H_RIGHT, V_DOWN)],       // ┌ down+right
  [0x2510, union(H_LEFT,  V_DOWN)],       // ┐ down+left
  [0x2514, union(H_RIGHT, V_UP)],         // └ up+right
  [0x2518, union(H_LEFT,  V_UP)],         // ┘ up+left

  // ── Thin T-junctions ──────────────────────────────────────────────────────
  [0x251C, union(V, H_RIGHT)],            // ├ right+up+down
  [0x2524, union(V, H_LEFT)],             // ┤ left+up+down
  [0x252C, union(H, V_DOWN)],             // ┬ down+left+right
  [0x2534, union(H, V_UP)],              // ┴ up+left+right
  [0x253C, union(H, V)],                  // ┼ cross

  // ── Heavy lines ───────────────────────────────────────────────────────────
  [0x2501, [0, 0, 0.9, 0.9, 0, 0]],      // ━ HEAVY HORIZONTAL
  [0x2503, [0.7, 0.7, 0.7, 0.7, 0.7, 0.7]], // ┃ HEAVY VERTICAL

  // ── Dashed lines ──────────────────────────────────────────────────────────
  [0x2504, [0, 0, 0.4, 0.4, 0, 0]],      // ┄ LIGHT TRIPLE DASH HORIZONTAL
  [0x2506, [0.3, 0.3, 0.3, 0.3, 0.3, 0.3]], // ┆ LIGHT TRIPLE DASH VERTICAL
  [0x2508, [0, 0, 0.3, 0.3, 0, 0]],      // ┈ LIGHT QUADRUPLE DASH HORIZONTAL
  [0x250A, [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]], // ┊ LIGHT QUADRUPLE DASH VERTICAL

  // ── Diagonal lines ────────────────────────────────────────────────────────
  [0x2571, [0, 0.8, 0.4, 0.4, 0.8, 0]],  // ╱ LIGHT DIAGONAL UPPER RIGHT TO LOWER LEFT
  [0x2572, [0.8, 0, 0.4, 0.4, 0, 0.8]],  // ╲ LIGHT DIAGONAL UPPER LEFT TO LOWER RIGHT
  [0x2573, [0.6, 0.6, 0.5, 0.5, 0.6, 0.6]], // ╳ LIGHT DIAGONAL CROSS
]

/**
 * Box drawing characters: lines, corners, T-junctions, crosses, diagonals.
 * Particularly useful for rendering wireframe geometry and grids.
 */
export const BOX: Charset = buildCharsetFromEntries(BOX_ENTRIES)
