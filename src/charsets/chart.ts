import type { Charset, ShapeVector } from "../types.ts"
import { buildCharsetFromEntries } from "../shape-vector.ts"
import { ASCII } from "./ascii.ts"
import { BLOCKS, SHADE } from "./blocks.ts"
import { BOX } from "./box.ts"

const HSTRIPE: ShapeVector = [0,   0,   0.5, 0.5, 0,   0  ]
const VSTRIPE: ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]

/**
 * Candlestick bodies and wicks. Half-blocks read as bodies; line characters
 * read as wicks and true doji markers.
 */
export const CANDLE: Charset = buildCharset([
  0x0020,
  0x2588,
  0x2580,
  0x2584,
  0x258c,
  0x2590,
  [0x2500, HSTRIPE],
  [0x2502, VSTRIPE],
  0x2581,
  0x2582,
  0x2583,
  0x2585,
  0x2586,
  0x2587,
  0x2596,
  0x2597,
  0x2598,
  0x259d,
  0x259a,
  0x259e,
  0x2599,
  0x259b,
  0x259c,
  0x259f,
])

const HEAVY_VERT:  ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
const HEAVY_DOWN:  ShapeVector = [0,   0,   0.5, 0.5, 0.5, 0.5]
const HEAVY_UP:    ShapeVector = [0.5, 0.5, 0.5, 0.5, 0,   0  ]
const HEAVY_HORIZ: ShapeVector = [0,   0,   0.5, 0.5, 0,   0  ]
const LIGHT_DOWN:  ShapeVector = [0,   0,   0.5, 0.5, 0.5, 0.5]
const LIGHT_UP:    ShapeVector = [0.5, 0.5, 0.5, 0.5, 0,   0  ]

/**
 * Heavy/light box-drawing candlestick vocabulary. Some members share the same
 * 2x3 sample geometry; direct cell ops can set `cp` to choose stroke weight.
 */
export const CANDLE_BOX: Charset = buildCharset([
  0x0020,
  [0x2500, HSTRIPE],
  [0x2501, HEAVY_HORIZ],
  [0x2503, HEAVY_VERT],
  [0x257b, HEAVY_DOWN],
  [0x2579, HEAVY_UP],
  [0x257d, HEAVY_DOWN],
  [0x257f, HEAVY_UP],
  [0x2502, VSTRIPE],
  [0x2577, LIGHT_DOWN],
  [0x2575, LIGHT_UP],
])

export const SPARK: Charset = buildCharset([
  0x0020,
  0x2588,
  0x2587,
  0x2586,
  0x2584,
  0x2585,
  0x2583,
  0x2582,
  0x2581,
])

const LEFT_QUARTER:  ShapeVector = [1, 0,   1, 0,   1, 0  ]
const LEFT_3Q:       ShapeVector = [1, 0.5, 1, 0.5, 1, 0.5]
const LEFT_BOUNDARY: ShapeVector = [0.5, 0, 0.5, 0, 0.5, 0]
const FULL:          ShapeVector = [1, 1, 1, 1, 1, 1]
const EMPTY:         ShapeVector = [0, 0, 0, 0, 0, 0]

export const DEPTH: Charset = buildCharset([
  0x0020,
  0x2588,
  [0x258a, LEFT_3Q],
  0x258c,
  [0x258e, LEFT_BOUNDARY],
  [0x2589, FULL],
  [0x258b, LEFT_QUARTER],
  [0x258d, LEFT_QUARTER],
  [0x258f, EMPTY],
])

export const AXIS: Charset = buildCharset([
  0x0020,
  0x2500,
  0x2502,
  0x250c,
  0x2510,
  0x2514,
  0x2518,
  0x251c,
  0x2524,
  0x252c,
  0x2534,
  0x253c,
])

function buildCharset(
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

function shapeOf(codepoint: number): ShapeVector | undefined {
  for (const cs of [SHADE, BLOCKS, BOX, ASCII]) {
    const entry = cs.find(e => e.codepoint === codepoint)
    if (entry !== undefined) return entry.sv
  }
  return undefined
}
