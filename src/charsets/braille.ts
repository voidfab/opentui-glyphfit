/**
 * Braille charset — all 256 Unicode braille patterns (U+2800–U+28FF).
 *
 * Shape vectors are derived analytically from the Unicode braille dot layout.
 *
 * Dot layout within a character cell (2-column × 4-row):
 *
 *   bit 0 (0x01): dot 1 — top-left      bit 3 (0x08): dot 4 — top-right
 *   bit 1 (0x02): dot 2 — mid-upper-L   bit 4 (0x10): dot 5 — mid-upper-R
 *   bit 2 (0x04): dot 3 — mid-lower-L   bit 5 (0x20): dot 6 — mid-lower-R
 *   bit 6 (0x40): dot 7 — bot-left      bit 7 (0x80): dot 8 — bot-right
 *
 * Dot rows sit at approximately 1/8, 3/8, 5/8, 7/8 of the cell height.
 * ShapeVector sample rows sit at 1/6, 3/6, 5/6 of the cell height.
 *
 * Mapping (minimising sample-to-dot vertical distance):
 *   v[0] = d1                 (top-left,  sample y≈1/6 ↔ dot-1 y≈1/8)
 *   v[1] = d4                 (top-right, sample y≈1/6 ↔ dot-4 y≈1/8)
 *   v[2] = (d2 + d3) / 2     (mid-left,  sample y≈3/6 straddles dots 2+3)
 *   v[3] = (d5 + d6) / 2     (mid-right, sample y≈3/6 straddles dots 5+6)
 *   v[4] = d7                 (bot-left,  sample y≈5/6 ↔ dot-7 y≈7/8)
 *   v[5] = d8                 (bot-right, sample y≈5/6 ↔ dot-8 y≈7/8)
 *
 * No external library or font rasterisation is used.
 */

import type { Charset, ShapeVector } from "../types.ts"
import { buildCharsetFromEntries } from "../shape-vector.ts"

function brailleShapeVector(bits: number): ShapeVector {
  const d1 = (bits & 0x01) !== 0 ? 1 : 0
  const d2 = (bits & 0x02) !== 0 ? 1 : 0
  const d3 = (bits & 0x04) !== 0 ? 1 : 0
  const d4 = (bits & 0x08) !== 0 ? 1 : 0
  const d5 = (bits & 0x10) !== 0 ? 1 : 0
  const d6 = (bits & 0x20) !== 0 ? 1 : 0
  const d7 = (bits & 0x40) !== 0 ? 1 : 0
  const d8 = (bits & 0x80) !== 0 ? 1 : 0

  return [
    d1,               // v[0]: top-left    ↔ dot 1
    d4,               // v[1]: top-right   ↔ dot 4
    (d2 + d3) / 2,   // v[2]: mid-left    ↔ dots 2+3 average
    (d5 + d6) / 2,   // v[3]: mid-right   ↔ dots 5+6 average
    d7,               // v[4]: bot-left    ↔ dot 7
    d8,               // v[5]: bot-right   ↔ dot 8
  ]
}

/**
 * All 256 Unicode braille patterns as a Charset.
 * Generated once at module load.
 */
export const BRAILLE: Charset = buildCharsetFromEntries(
  Array.from({ length: 256 }, (_, bits) => [0x2800 + bits, brailleShapeVector(bits)])
)
