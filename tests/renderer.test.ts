import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { drawGlyphFit, matchField, sampleField } from "../src/renderer.ts"
import { drawGlyphFitColor } from "../src/color-renderer.ts"
import { BRAILLE } from "../src/charsets/braille.ts"
import { BLOCKS, SHADE } from "../src/charsets/blocks.ts"
import {
  InvalidFieldError,
  InvalidOptionsError,
} from "../src/errors.ts"
import type { BufferLike } from "../src/types.ts"

interface MockBuffer extends BufferLike {
  calls: Array<{ char: number; x: number; y: number; fg: RGBA; bg: RGBA }>
}

function mockBuffer(w: number, h: number): MockBuffer {
  const calls: MockBuffer["calls"] = []
  return {
    width: w,
    height: h,
    drawChar(char, x, y, fg, bg) { calls.push({ char, x, y, fg, bg }) },
    calls,
  }
}

const WHITE = RGBA.fromValues(1, 1, 1, 1)
const BLACK = RGBA.fromValues(0, 0, 0, 1)

/* ─── drawGlyphFit ─────────────────────────────────────────────────────── */

describe("drawGlyphFit — happy path", () => {
  it("skips all cells for a zero intensity field", () => {
    const buf = mockBuffer(10, 5)
    const intensities = new Float32Array(10 * 5)
    drawGlyphFit(buf, { intensities, srcWidth: 10, srcHeight: 5, x: 0, y: 0, fg: WHITE, bg: BLACK })
    expect(buf.calls.length).toBe(0)
  })

  it("draws all cells of a buffer when fed a full-intensity field", () => {
    const W = 5, H = 3
    const buf = mockBuffer(W, H)
    const intensities = new Float32Array(W * 2 * H * 2).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: W * 2, srcHeight: H * 2,
      x: 0, y: 0, fg: WHITE, bg: BLACK,
    })
    expect(buf.calls.length).toBe(W * H)
  })

  it("full intensity selects U+2588 (full block) with BLOCKS", () => {
    const buf = mockBuffer(1, 1)
    const intensities = new Float32Array(4 * 4).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 4, x: 0, y: 0,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
    })
    expect(buf.calls[0]?.char).toBe(0x2588)
  })

  it("respects threshold — cells below threshold are not drawn", () => {
    const buf = mockBuffer(4, 4)
    const intensities = new Float32Array(4 * 4).fill(0.01)
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 4, x: 0, y: 0,
      fg: WHITE, bg: BLACK, threshold: 0.02,
    })
    expect(buf.calls.length).toBe(0)
  })

  it("uses BRAILLE charset by default", () => {
    const buf = mockBuffer(1, 1)
    const intensities = new Float32Array(4 * 4).fill(1)
    drawGlyphFit(buf, { intensities, srcWidth: 4, srcHeight: 4, x: 0, y: 0, fg: WHITE, bg: BLACK })
    const cp = buf.calls[0]?.char ?? 0
    expect(cp).toBeGreaterThanOrEqual(0x2800)
    expect(cp).toBeLessThanOrEqual(0x28FF)
  })
})

/* ─── Destination region (the bug from review) ─────────────────────────── */

describe("drawGlyphFit — destination region", () => {
  it("draws into a region starting at (destX, destY)", () => {
    const buf = mockBuffer(20, 10)
    const intensities = new Float32Array(8 * 4).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 8, srcHeight: 4,
      x: 5, y: 2, destWidth: 4, destHeight: 2,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
    })
    expect(buf.calls.length).toBe(4 * 2)
    // All draws fall inside the requested region.
    for (const c of buf.calls) {
      expect(c.x).toBeGreaterThanOrEqual(5)
      expect(c.x).toBeLessThan(9)
      expect(c.y).toBeGreaterThanOrEqual(2)
      expect(c.y).toBeLessThan(4)
    }
  })

  it("clamps destination region against buffer bounds", () => {
    const buf = mockBuffer(10, 5)
    const intensities = new Float32Array(20 * 10).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 20, srcHeight: 10,
      x: 8, y: 3, destWidth: 10, destHeight: 10,  // overflows the 10x5 buffer
      fg: WHITE, bg: BLACK, charset: BLOCKS,
    })
    // Cells written: x in [8, 10), y in [3, 5)  → 2x2 = 4
    expect(buf.calls.length).toBe(4)
  })

  it("destWidth/destHeight default to fill from (x, y) to buffer edge", () => {
    const buf = mockBuffer(6, 4)
    const intensities = new Float32Array(8 * 6).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 8, srcHeight: 6,
      x: 2, y: 1,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
    })
    // 4 cols × 3 rows = 12
    expect(buf.calls.length).toBe(12)
  })

  it("right-half dest at non-zero x preserves field aspect (no squish)", () => {
    // Dest panel is 4 cells wide. Source is 8x6. Per cell there should be 2 source columns.
    // Verify the leftmost dest cell's character matches a "full" sample, not a stretched one.
    const buf = mockBuffer(20, 4)
    const intensities = new Float32Array(8 * 6).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 8, srcHeight: 6,
      x: 10, y: 0, destWidth: 4, destHeight: 3,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
    })
    // All cells should be solid (full block) since the field is uniformly 1.
    for (const c of buf.calls) {
      expect(c.char).toBe(0x2588)
    }
  })
})

/* ─── Validation ───────────────────────────────────────────────────────── */

describe("drawGlyphFit — validation", () => {
  const baseField = new Float32Array(4 * 4).fill(0.5)
  const baseOpt = { intensities: baseField, srcWidth: 4, srcHeight: 4, x: 0, y: 0, fg: WHITE, bg: BLACK }

  it("throws InvalidFieldError if intensities length mismatches dimensions", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, srcWidth: 5 })).toThrow(InvalidFieldError)
  })

  it("throws InvalidFieldError on zero/negative srcWidth", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, srcWidth: 0, intensities: new Float32Array(0) })).toThrow(InvalidFieldError)
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, srcWidth: -1 })).toThrow(InvalidFieldError)
  })

  it("throws InvalidOptionsError on non-finite gamma", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, gamma: NaN })).toThrow(InvalidOptionsError)
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, gamma: 0 })).toThrow(InvalidOptionsError)
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, gamma: -1 })).toThrow(InvalidOptionsError)
  })

  it("throws InvalidOptionsError on out-of-range threshold", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, threshold: -0.1 })).toThrow(InvalidOptionsError)
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, threshold: 1.1 })).toThrow(InvalidOptionsError)
  })

  it("throws InvalidOptionsError on empty charset", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, charset: [] })).toThrow(InvalidOptionsError)
  })

  it("throws InvalidOptionsError on non-integer destX/destY/destWidth", () => {
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, x: 0.5 })).toThrow(InvalidOptionsError)
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, destWidth: 1.5 })).toThrow(InvalidOptionsError)
  })

  it("unsafe: true skips validation (does not throw on bad input)", () => {
    // Length mismatch with unsafe → no throw, just silent drawing of whatever we can.
    expect(() => drawGlyphFit(mockBuffer(1, 1), { ...baseOpt, srcWidth: 5, unsafe: true })).not.toThrow()
  })
})

/* ─── Robustness against degenerate input ──────────────────────────────── */

describe("drawGlyphFit — degenerate input", () => {
  it("survives NaN values in intensities (treats as 0)", () => {
    const intensities = new Float32Array(4 * 4)
    intensities.fill(1)
    intensities[5] = NaN
    intensities[10] = Number.POSITIVE_INFINITY
    const buf = mockBuffer(1, 1)
    drawGlyphFit(buf, { intensities, srcWidth: 4, srcHeight: 4, x: 0, y: 0, fg: WHITE, bg: BLACK })
    expect(buf.calls.length).toBe(1)
    // A finite codepoint was drawn.
    expect(Number.isInteger(buf.calls[0]!.char)).toBe(true)
  })

  it("returns silently when destX is past the buffer edge", () => {
    const buf = mockBuffer(5, 5)
    const intensities = new Float32Array(4 * 4).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 4,
      x: 100, y: 100, destWidth: 4, destHeight: 4,
      fg: WHITE, bg: BLACK,
    })
    expect(buf.calls.length).toBe(0)
  })

  it("returns silently when destWidth is 0", () => {
    const buf = mockBuffer(5, 5)
    const intensities = new Float32Array(4 * 4).fill(1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 4,
      x: 0, y: 0, destWidth: 0, destHeight: 4,
      fg: WHITE, bg: BLACK,
    })
    expect(buf.calls.length).toBe(0)
  })
})

/* ─── intensityToFg callback ──────────────────────────────────────────── */

describe("drawGlyphFit — intensityToFg", () => {
  it("invokes intensityToFg once per drawn cell with the cell's mean", () => {
    // 2-cell-wide buffer, source field 4×2.
    // Left half of each row = 0.25, right half = 0.75.
    const buf = mockBuffer(2, 1)
    const intensities = new Float32Array(4 * 2)
    for (let y = 0; y < 2; y++) {
      intensities[y * 4 + 0] = 0.25
      intensities[y * 4 + 1] = 0.25
      intensities[y * 4 + 2] = 0.75
      intensities[y * 4 + 3] = 0.75
    }
    const seen: number[] = []
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 2, x: 0, y: 0,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
      intensityToFg: (avg) => { seen.push(avg); return WHITE },
    })
    expect(seen.length).toBe(2)
    expect(seen[0]!).toBeCloseTo(0.25, 1)
    expect(seen[1]!).toBeCloseTo(0.75, 1)
  })

  it("uses returned RGBA as the cell foreground", () => {
    const buf = mockBuffer(1, 1)
    const intensities = new Float32Array(4 * 4).fill(0.5)
    const customFg = RGBA.fromValues(0.1, 0.2, 0.3, 1)
    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 4, x: 0, y: 0,
      fg: WHITE, bg: BLACK, charset: BLOCKS,
      intensityToFg: () => customFg,
    })
    expect(buf.calls[0]!.fg).toBe(customFg)
  })
})

/* ─── matchField & sampleField ────────────────────────────────────────── */

describe("matchField", () => {
  it("returns destWidth × destHeight codepoints", () => {
    const intensities = new Float32Array(6 * 4).fill(0.5)
    const result = matchField(intensities, 6, 4, 3, 2)
    expect(result.length).toBe(6)
  })

  it("all-zero intensity maps to empty braille (U+2800)", () => {
    const intensities = new Float32Array(4 * 4)
    const result = matchField(intensities, 4, 4, 1, 1, BRAILLE)
    expect(result[0]).toBe(0x2800)
  })

  it("all-one intensity maps to full braille (U+28FF)", () => {
    const intensities = new Float32Array(4 * 4).fill(1)
    const result = matchField(intensities, 4, 4, 1, 1, BRAILLE)
    expect(result[0]).toBe(0x28FF)
  })

  it("a left-only field maps to a left-column braille char", () => {
    const W = 10, H = 10
    const intensities = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) intensities[y * W + x] = 1
    const result = matchField(intensities, W, H, 1, 1, BRAILLE)
    const bits = result[0]! - 0x2800
    expect(bits & 0b01000111).toBeGreaterThan(0)  // d1,d2,d3,d7 present
    expect(bits & 0b10111000).toBe(0)             // d4,d5,d6,d8 absent
  })

  it("throws on empty charset", () => {
    expect(() => matchField(new Float32Array(4), 2, 2, 1, 1, [])).toThrow(InvalidOptionsError)
  })
})

describe("sampleField", () => {
  it("returns destWidth × destHeight ShapeVectors", () => {
    const intensities = new Float32Array(6 * 4).fill(0.5)
    const result = sampleField(intensities, 6, 4, 3, 2)
    expect(result.length).toBe(6)
    for (const sv of result) expect(sv.length).toBe(6)
  })

  it("all-zero field gives all-zero ShapeVectors", () => {
    const intensities = new Float32Array(8 * 6)
    const result = sampleField(intensities, 8, 6, 4, 3)
    for (const sv of result) for (const v of sv) expect(v).toBe(0)
  })
})

/* ─── drawGlyphFitColor ───────────────────────────────────────────────── */

describe("drawGlyphFitColor", () => {
  it("draws every cell when fed a uniform colour field", () => {
    const W = 4, H = 2, srcW = W * 2, srcH = H * 2
    const rgba = new Float32Array(srcW * srcH * 4)
    for (let i = 0; i < srcW * srcH; i++) {
      rgba[i * 4] = 0.5
      rgba[i * 4 + 1] = 0.6
      rgba[i * 4 + 2] = 0.7
      rgba[i * 4 + 3] = 1
    }
    const buf = mockBuffer(W, H)
    drawGlyphFitColor(buf, { rgba, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0 })
    expect(buf.calls.length).toBe(W * H)
  })

  it("validates rgba length", () => {
    const buf = mockBuffer(1, 1)
    expect(() => drawGlyphFitColor(buf, {
      rgba: new Float32Array(10), srcWidth: 4, srcHeight: 4, x: 0, y: 0,
    })).toThrow(InvalidFieldError)
  })

  it("emits empty-bg space for cells below threshold", () => {
    const W = 1, H = 1
    const rgba = new Float32Array(W * 2 * H * 2 * 4)  // all zeros
    const buf = mockBuffer(W, H)
    drawGlyphFitColor(buf, {
      rgba, srcWidth: W * 2, srcHeight: H * 2, x: 0, y: 0,
      threshold: 0.5,
    })
    expect(buf.calls.length).toBe(1)
    expect(buf.calls[0]!.char).toBe(0x20)
  })

  it("assigns brighter pixel as fg, darker as bg", () => {
    const W = 1, H = 1, srcW = 2, srcH = 2
    const rgba = new Float32Array(srcW * srcH * 4)
    // Pixel 0 dark, pixel 3 bright.
    rgba.set([0.1, 0.1, 0.1, 1], 0)
    rgba.set([0.1, 0.1, 0.1, 1], 4)
    rgba.set([0.1, 0.1, 0.1, 1], 8)
    rgba.set([0.9, 0.9, 0.9, 1], 12)
    const buf = mockBuffer(W, H)
    drawGlyphFitColor(buf, { rgba, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0 })
    const c = buf.calls[0]!
    // fg should be bright (≈0.9)
    expect(c.fg.r).toBeGreaterThan(0.7)
    // bg should be dark (≈0.1)
    expect(c.bg.r).toBeLessThan(0.3)
  })
})
