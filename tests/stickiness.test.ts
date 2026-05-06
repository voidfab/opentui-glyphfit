import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { StickyMatcher } from "../src/stickiness.ts"
import { compileCharset } from "../src/compiled-charset.ts"
import { drawGlyphFit, BLOCKS_SHADE } from "../src/index.ts"
import type { BufferLike, ShapeVector } from "../src/types.ts"
import { buildCharsetFromEntries } from "../src/shape-vector.ts"

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

function recordingBuffer(w: number, h: number) {
  const calls: Array<{ char: number; x: number; y: number }> = []
  const buf: BufferLike = {
    width: w, height: h,
    drawChar(char, x, y) { calls.push({ char, x, y }) },
  }
  return { buf, calls }
}

describe("StickyMatcher", () => {
  // Two near-identical chars with SVs separated by ~0.045 distance —
  // small enough that stickiness suppresses flips.
  const tinyCharset = buildCharsetFromEntries([
    [0x41, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]],  // 'A' — uniform 0.5
    [0x42, [0.6, 0.6, 0.5, 0.5, 0.5, 0.5]],  // 'B' — top row brighter
  ])

  it("with tolerance=0 behaves like findBestCharIn", () => {
    const compiled = compileCharset(tinyCharset)
    const m = new StickyMatcher({ tolerance: 0 })
    m.resize(1, 1)

    const a: ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    const b: ShapeVector = [0.6, 0.6, 0.5, 0.5, 0.5, 0.5]

    expect(m.match(a, 0, compiled)).toBe(0x41)
    expect(m.match(b, 0, compiled)).toBe(0x42)
    expect(m.match(a, 0, compiled)).toBe(0x41)
  })

  it("with tolerance=0.05 holds the previous char near the boundary", () => {
    const compiled = compileCharset(tinyCharset)
    const m = new StickyMatcher({ tolerance: 0.05 })
    m.resize(1, 1)

    // First frame: clearly 'A'.
    const clearA: ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    expect(m.match(clearA, 0, compiled)).toBe(0x41)

    // Second frame: ambiguous — slightly closer to 'B' but within tolerance of 'A'.
    // SV [0.55, 0.55, 0.5, 0.5, 0.5, 0.5]:
    //   d(A) = 0.05^2 + 0.05^2 = 0.005
    //   d(B) = 0.05^2 + 0.05^2 = 0.005   — exact tie, but 'A' was previous so it sticks.
    const ambiguous: ShapeVector = [0.55, 0.55, 0.5, 0.5, 0.5, 0.5]
    expect(m.match(ambiguous, 0, compiled)).toBe(0x41)
  })

  it("flips when the new best is meaningfully better than the held char", () => {
    const compiled = compileCharset(tinyCharset)
    const m = new StickyMatcher({ tolerance: 0.05 })
    m.resize(1, 1)

    m.match([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0, compiled)         // start at 'A'
    // Far closer to 'B' than 'A' — gap exceeds tolerance.
    expect(m.match([0.7, 0.7, 0.5, 0.5, 0.5, 0.5], 0, compiled)).toBe(0x42)
  })

  it("reset() drops cached state", () => {
    const compiled = compileCharset(tinyCharset)
    const m = new StickyMatcher({ tolerance: 0.05 })
    m.resize(1, 1)
    m.match([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0, compiled)
    m.reset()
    // After reset, the boundary case picks fresh — no held codepoint.
    expect(m.match([0.55, 0.55, 0.5, 0.5, 0.5, 0.5], 0, compiled)).toBe(0x41)
  })

  it("resize clears state and accommodates new dimensions", () => {
    const compiled = compileCharset(tinyCharset)
    const m = new StickyMatcher({ tolerance: 0.05 })
    m.resize(2, 2)
    m.match([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 0, compiled)
    m.resize(4, 4)
    expect(m.match([0.55, 0.55, 0.5, 0.5, 0.5, 0.5], 0, compiled)).toBe(0x41)
  })
})

describe("drawGlyphFit + StickyMatcher integration", () => {
  it("produces no flicker between frames at the boundary", () => {
    const W = 2, H = 1
    const sticky = new StickyMatcher({ tolerance: 0.05 })
    sticky.resize(W, H)

    // Field: each cell mean ≈ 0.5, varying slightly between frames.
    const f1 = new Float32Array(4 * 2).fill(0.5)
    const f2 = new Float32Array(4 * 2).fill(0.51)
    const f3 = new Float32Array(4 * 2).fill(0.49)

    const r1 = recordingBuffer(W, H)
    drawGlyphFit(r1.buf, { intensities: f1, srcWidth: 4, srcHeight: 2, x: 0, y: 0, fg: FG, bg: BG, charset: BLOCKS_SHADE, sticky })
    const r2 = recordingBuffer(W, H)
    drawGlyphFit(r2.buf, { intensities: f2, srcWidth: 4, srcHeight: 2, x: 0, y: 0, fg: FG, bg: BG, charset: BLOCKS_SHADE, sticky })
    const r3 = recordingBuffer(W, H)
    drawGlyphFit(r3.buf, { intensities: f3, srcWidth: 4, srcHeight: 2, x: 0, y: 0, fg: FG, bg: BG, charset: BLOCKS_SHADE, sticky })

    // All three frames pick the same char per cell despite intensity wobble.
    expect(r1.calls.map(c => c.char)).toEqual(r2.calls.map(c => c.char))
    expect(r2.calls.map(c => c.char)).toEqual(r3.calls.map(c => c.char))
  })
})
