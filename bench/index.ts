#!/usr/bin/env bun
/**
 * Microbenchmark for opentui-glyphfit.
 *
 * Usage: bun bench/index.ts
 *
 * Reports per-frame time across charsets and field sizes against a
 * realistic plasma intensity field. Use to spot performance regressions
 * before merging changes to the hot path.
 */

import { RGBA } from "@opentui/core"
import { drawGlyphFit } from "../src/renderer.ts"
import { compileCharset } from "../src/compiled-charset.ts"
import { sampleShapeVectorInto } from "../src/shape-vector.ts"
import { findBestCharIn } from "../src/compiled-charset.ts"
import { BRAILLE } from "../src/charsets/braille.ts"
import { BLOCKS_SHADE, BLOCKS, SHADE } from "../src/charsets/blocks.ts"
import { BOX } from "../src/charsets/box.ts"
import { ASCII } from "../src/charsets/ascii.ts"
import type { BufferLike, ShapeVector } from "../src/types.ts"

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

function noopBuffer(w: number, h: number): BufferLike {
  return { width: w, height: h, drawChar() {} }
}

function plasmaField(srcW: number, srcH: number, t = 0.5): Float32Array {
  const f = new Float32Array(srcW * srcH)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const nx = x / srcW, ny = y / srcH
      const v1 = Math.sin(nx * 14 + t)
      const v2 = Math.sin(ny * 14 + t * 0.7)
      const v3 = Math.sin((nx + ny) * 11 + t * 1.3)
      const v4 = Math.sin(Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 18 - t * 2)
      f[y * srcW + x] = (v1 + v2 + v3 + v4 + 4) / 8
    }
  }
  return f
}

function bench(label: string, fn: () => void, iters: number): { mean: number; p99: number } {
  // Warm-up.
  for (let i = 0; i < 5; i++) fn()
  const samples = new Float64Array(iters)
  for (let i = 0; i < iters; i++) {
    const t = performance.now()
    fn()
    samples[i] = performance.now() - t
  }
  let sum = 0
  for (const s of samples) sum += s
  const mean = sum / iters
  const sorted = [...samples].sort((a, b) => a - b)
  const p99 = sorted[Math.min(iters - 1, Math.floor(iters * 0.99))]!
  console.log(`  ${label.padEnd(40)} mean=${mean.toFixed(2)}ms  p99=${p99.toFixed(2)}ms`)
  return { mean, p99 }
}

const CHARSETS = [
  ["BRAILLE     ", BRAILLE],
  ["BLOCKS_SHADE", BLOCKS_SHADE],
  ["BLOCKS      ", BLOCKS],
  ["BOX         ", BOX],
  ["ASCII       ", ASCII],
  ["SHADE       ", SHADE],
] as const

const SIZES = [
  ["80×24  (small)",  80,  24],
  ["160×40 (medium)", 160, 40],
  ["200×50 (large)",  200, 50],
] as const

console.log("\n=== drawGlyphFit (full pipeline) ===\n")
for (const [sizeLabel, W, H] of SIZES) {
  console.log(`${sizeLabel}:`)
  const srcW = W * 3, srcH = H * 3
  const f = plasmaField(srcW, srcH)
  const buf = noopBuffer(W, H)
  for (const [csLabel, cs] of CHARSETS) {
    compileCharset(cs)
    bench(`${csLabel} (${cs.length} chars)`, () => {
      drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: cs })
    }, 30)
  }
  console.log()
}

console.log("=== sampleShapeVectorInto (sampling only) ===\n")
{
  const srcW = 200 * 3, srcH = 50 * 3
  const f = plasmaField(srcW, srcH)
  const sv: ShapeVector = [0, 0, 0, 0, 0, 0]
  bench("200×50 grid, area-weighted", () => {
    for (let y = 0; y < 50; y++) for (let x = 0; x < 200; x++)
      sampleShapeVectorInto(sv, f, srcW, srcH, x, y, 200, 50)
  }, 30)
}

console.log("\n=== findBestCharIn (matching only) ===\n")
{
  const sv: ShapeVector = [0.4, 0.6, 0.3, 0.7, 0.2, 0.8]
  for (const [csLabel, cs] of CHARSETS) {
    const c = compileCharset(cs)
    bench(`${csLabel} × 10000 calls`, () => {
      for (let i = 0; i < 10000; i++) findBestCharIn(sv, c)
    }, 30)
  }
}

console.log("\n=== empty-field fast path ===\n")
{
  const W = 200, H = 50, srcW = W * 3, srcH = H * 3
  const f = new Float32Array(srcW * srcH)  // all zeros
  const buf = noopBuffer(W, H)
  compileCharset(BRAILLE)
  bench("200×50 all-zero, BRAILLE", () => {
    drawGlyphFit(buf, { intensities: f, srcWidth: srcW, srcHeight: srcH, x: 0, y: 0, fg: FG, bg: BG, charset: BRAILLE })
  }, 30)
}
console.log()
