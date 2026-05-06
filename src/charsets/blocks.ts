/**
 * Block character charsets.
 *
 * Shape vectors are derived analytically from the Unicode character definitions.
 * Each block character divides the cell into mathematically defined rectangular
 * regions. Coverage at each ShapeVector sample point is 1.0 if the point falls
 * inside the character's ink region, 0.0 outside, and 0.5 at the boundary
 * (sample point exactly on the edge between ink and no-ink).
 *
 * Sample point positions within a cell:
 *   row:  top(1/6), mid(3/6), bot(5/6)
 *   col: left(1/4), right(3/4)
 *
 * The mid-row sample (y=0.5) falls exactly on the boundary of upper/lower half
 * blocks, so it receives 0.5.
 */

import type { Charset, ShapeVector } from "../types.ts"
import { buildCharsetFromEntries } from "../shape-vector.ts"

// ─── Half-block and full-block ────────────────────────────────────────────────

// Space: U+0020
const SPACE: ShapeVector      = [0,   0,   0,   0,   0,   0  ]
// █ FULL BLOCK: U+2588
const FULL: ShapeVector       = [1,   1,   1,   1,   1,   1  ]
// ▀ UPPER HALF: U+2580 — ink from y=0 to y=0.5; mid sample is on the boundary
const UPPER_HALF: ShapeVector = [1,   1,   0.5, 0.5, 0,   0  ]
// ▄ LOWER HALF: U+2584 — ink from y=0.5 to y=1
const LOWER_HALF: ShapeVector = [0,   0,   0.5, 0.5, 1,   1  ]
// ▌ LEFT HALF: U+258C — ink from x=0 to x=0.5; left sample(1/4) inside, right(3/4) outside
const LEFT_HALF: ShapeVector  = [1,   0,   1,   0,   1,   0  ]
// ▐ RIGHT HALF: U+2590 — ink from x=0.5 to x=1
const RIGHT_HALF: ShapeVector = [0,   1,   0,   1,   0,   1  ]

// ─── Shade characters ─────────────────────────────────────────────────────────
// These are uniform across the cell; the values represent approximate ink density.

// ░ LIGHT SHADE: U+2591
const LIGHT_SHADE: ShapeVector  = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25]
// ▒ MEDIUM SHADE: U+2592
const MEDIUM_SHADE: ShapeVector = [0.5,  0.5,  0.5,  0.5,  0.5,  0.5 ]
// ▓ DARK SHADE: U+2593
const DARK_SHADE: ShapeVector   = [0.75, 0.75, 0.75, 0.75, 0.75, 0.75]

// ─── Vertical eighths (U+2581–U+2588) ────────────────────────────────────────
// ▁▂▃▄▅▆▇█  Lower N/8 blocks.
// Sample rows at y = 1/6, 3/6, 5/6. Ink fills from y=1 upward.
//   bot(5/6) is inside for N≥7/8 → fraction = N/8 > 5/6 ≈ 0.833
//   mid(3/6) is inside for N≥5/8 → fraction = N/8 > 3/6 = 0.5
//   top(1/6) is inside for N≥2/8 → fraction = N/8 > 1/6 ≈ 0.167

function lowerEighth(n: number): ShapeVector {
  // Ink covers the bottom n/8 of the cell (y from (1 - n/8) to 1).
  const threshold = 1 - n / 8  // y below which there is no ink
  const top = topSample(threshold)
  const mid = midSample(threshold)
  const bot = botSample(threshold)
  return [top, top, mid, mid, bot, bot]
}

// How much of the sample at y=1/6 is covered when ink starts at `threshold`
function topSample(threshold: number): number {
  return threshold <= 1 / 6 ? 1 : threshold <= 2 / 6 ? 0.5 : 0
}
function midSample(threshold: number): number {
  return threshold <= 2 / 6 ? 1 : threshold <= 4 / 6 ? 0.5 : 0
}
function botSample(threshold: number): number {
  return threshold <= 4 / 6 ? 1 : threshold <= 5 / 6 ? 0.5 : 0
}

// ─── Quadrant blocks ──────────────────────────────────────────────────────────
// The cell is divided into 4 quadrants: TL, TR, BL, BR.
// Sample point (top,left)=(0,0) is in TL; (top,right) in TR; etc.
// The mid row (y=1/2) straddles top/bottom quadrants → 0.5.

function quadrant(tl: boolean, tr: boolean, bl: boolean, br: boolean): ShapeVector {
  return [
    tl ? 1 : 0,          // v[0]: top-left
    tr ? 1 : 0,          // v[1]: top-right
    (tl || bl) ? 0.5 : 0, // v[2]: mid-left  — straddles top/bot quadrant
    (tr || br) ? 0.5 : 0, // v[3]: mid-right — straddles top/bot quadrant
    bl ? 1 : 0,          // v[4]: bot-left
    br ? 1 : 0,          // v[5]: bot-right
  ]
}

// ─── Charset definitions ──────────────────────────────────────────────────────

const SHADE_ENTRIES: Array<[number, ShapeVector]> = [
  [0x0020, SPACE],        // ' '
  [0x2591, LIGHT_SHADE],  // ░
  [0x2592, MEDIUM_SHADE], // ▒
  [0x2593, DARK_SHADE],   // ▓
]

const BLOCK_ENTRIES: Array<[number, ShapeVector]> = [
  [0x0020, SPACE],        // ' '
  [0x2588, FULL],         // █
  [0x2580, UPPER_HALF],   // ▀
  [0x2584, LOWER_HALF],   // ▄
  [0x258C, LEFT_HALF],    // ▌
  [0x2590, RIGHT_HALF],   // ▐

  // Lower eighths: ▁▂▃▅▆▇  (▄ U+2584 covered above as LOWER_HALF, ▇ at 7/8)
  // U+2584 (4/8) is omitted here to avoid duplicating the LOWER_HALF entry above.
  [0x2581, lowerEighth(1)],
  [0x2582, lowerEighth(2)],
  [0x2583, lowerEighth(3)],
  [0x2585, lowerEighth(5)],
  [0x2586, lowerEighth(6)],
  [0x2587, lowerEighth(7)],

  // Quadrant blocks
  [0x2596, quadrant(false, false, true,  false)], // ▖ LOWER LEFT
  [0x2597, quadrant(false, false, false, true )], // ▗ LOWER RIGHT
  [0x2598, quadrant(true,  false, false, false)], // ▘ UPPER LEFT
  [0x259D, quadrant(false, true,  false, false)], // ▝ UPPER RIGHT
  [0x259A, quadrant(true,  false, false, true )], // ▚ UL + LR
  [0x259E, quadrant(false, true,  true,  false)], // ▞ UR + LL
  [0x2599, quadrant(true,  false, true,  true )], // ▙ UL + LL + LR
  [0x259B, quadrant(true,  true,  true,  false)], // ▛ UL + UR + LL
  [0x259C, quadrant(true,  true,  false, true )], // ▜ UL + UR + LR
  [0x259F, quadrant(false, true,  true,  true )], // ▟ UR + LL + LR
]

/**
 * Shade characters only: space, ░, ▒, ▓.
 * Good for smooth gradients without directional bias.
 */
export const SHADE: Charset = buildCharsetFromEntries(SHADE_ENTRIES)

/**
 * Block characters: halves, eighths, quadrants.
 * Best for geometric, hard-edged content.
 */
export const BLOCKS: Charset = buildCharsetFromEntries(BLOCK_ENTRIES)

/**
 * Blocks ∪ Shade — a good general-purpose charset covering both gradients
 * and geometric shapes.
 */
export const BLOCKS_SHADE: Charset = buildCharsetFromEntries([
  ...BLOCK_ENTRIES,
  [0x2591, LIGHT_SHADE],
  [0x2592, MEDIUM_SHADE],
  [0x2593, DARK_SHADE],
])
