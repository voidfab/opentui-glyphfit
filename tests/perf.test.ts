/**
 * Performance regression tests. These set generous bounds (CI machines vary
 * ~3-10×); they're meant to catch order-of-magnitude regressions, not micro
 * changes. For real measurements use `bun bench/index.ts`.
 */
import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { drawGlyphFit } from "../src/renderer.ts"
import { compileCharset } from "../src/compiled-charset.ts"
import { BRAILLE } from "../src/charsets/braille.ts"
import { BLOCKS_SHADE } from "../src/charsets/blocks.ts"
import type { BufferLike } from "../src/types.ts"

function noopBuffer(w: number, h: number): BufferLike {
  return {
    width: w,
    height: h,
    drawChar() { /* no-op — measure compute, not buffer cost */ },
  }
}

function plasmaField(srcW: number, srcH: number): Float32Array {
  const f = new Float32Array(srcW * srcH)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const nx = x / srcW, ny = y / srcH
      f[y * srcW + x] = (Math.sin(nx * 14) + Math.sin(ny * 14) + Math.sin((nx + ny) * 11) + 3) / 6
    }
  }
  return f
}

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

describe("perf — regression bounds", () => {
  it("drawGlyphFit @ 200×50 with BRAILLE: < 100ms (5 frames)", () => {
    const W = 200, H = 50
    const srcW = W * 3, srcH = H * 3
    const f = plasmaField(srcW, srcH)
    const buf = noopBuffer(W, H)

    // Warm up the JIT and the WeakMap cache for the charset.
    compileCharset(BRAILLE)
    drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BRAILLE })

    const t0 = performance.now()
    for (let i = 0; i < 5; i++) {
      drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BRAILLE })
    }
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(100)
  })

  it("drawGlyphFit @ 200×50 with BLOCKS_SHADE: < 60ms (5 frames)", () => {
    const W = 200, H = 50
    const srcW = W * 3, srcH = H * 3
    const f = plasmaField(srcW, srcH)
    const buf = noopBuffer(W, H)

    compileCharset(BLOCKS_SHADE)
    drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BLOCKS_SHADE })

    const t0 = performance.now()
    for (let i = 0; i < 5; i++) {
      drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BLOCKS_SHADE })
    }
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(60)
  })

  it("threshold-first skip path is fast on empty fields", () => {
    // All-zero field: every cell skipped. This is the "empty space" common case.
    const W = 200, H = 50
    const srcW = W * 3, srcH = H * 3
    const f = new Float32Array(srcW * srcH)
    const buf = noopBuffer(W, H)

    compileCharset(BRAILLE)
    drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BRAILLE })

    const t0 = performance.now()
    for (let i = 0; i < 20; i++) {
      drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BRAILLE })
    }
    const elapsed = performance.now() - t0
    // 20 frames of an empty 200x50 field should be very fast — only the cheap mean pass runs.
    expect(elapsed).toBeLessThan(120)
  })
})
