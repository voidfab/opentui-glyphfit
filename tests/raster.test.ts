import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import { renderToImagePixels, BLOCKS, BLOCKS_SHADE, BRAILLE, BOX, ASCII, paletteFg, FIRE } from "../src/index.ts"
import { InvalidOptionsError } from "../src/errors.ts"

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

function fullField(W: number, H: number): Float32Array {
  const f = new Float32Array(W * H)
  f.fill(1)
  return f
}

function pixelAt(img: { rgba: Uint8Array; width: number }, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4
  return [img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!, img.rgba[i + 3]!]
}

function isBg(p: [number, number, number, number]): boolean {
  return p[0] === 0 && p[1] === 0 && p[2] === 0
}
function isFg(p: [number, number, number, number]): boolean {
  return p[0] === 255 && p[1] === 255 && p[2] === 255
}

describe("renderToImagePixels — sizing", () => {
  it("output dimensions = destWidth*cellWidth × destHeight*cellHeight", () => {
    const img = renderToImagePixels({
      intensities: fullField(8 * 3, 4 * 3), srcWidth: 24, srcHeight: 12,
      destWidth: 8, destHeight: 4,
      fg: FG, bg: BG, charset: BLOCKS,
      cellWidth: 12, cellHeight: 24,
    })
    expect(img.width).toBe(8 * 12)
    expect(img.height).toBe(4 * 24)
    expect(img.rgba.length).toBe(img.width * img.height * 4)
  })

  it("default cell size 16×32 yields the expected output dims", () => {
    const img = renderToImagePixels({
      intensities: fullField(6, 6), srcWidth: 6, srcHeight: 6,
      destWidth: 2, destHeight: 1,
      fg: FG, bg: BG, charset: BLOCKS,
    })
    expect(img.width).toBe(2 * 16)
    expect(img.height).toBe(1 * 32)
  })

  it("throws InvalidOptionsError on cellWidth ≤ 0", () => {
    expect(() => renderToImagePixels({
      intensities: fullField(4, 4), srcWidth: 4, srcHeight: 4,
      destWidth: 2, destHeight: 1, fg: FG, bg: BG, charset: BLOCKS,
      cellWidth: 0,
    })).toThrow(InvalidOptionsError)
  })
})

describe("renderToImagePixels — character rasterization", () => {
  // 1×1 cell at full intensity: U+2588 (full block). Every pixel should be fg.
  it("full intensity + BLOCKS produces a solid foreground rectangle (U+2588)", () => {
    const img = renderToImagePixels({
      intensities: fullField(4, 4), srcWidth: 4, srcHeight: 4,
      destWidth: 1, destHeight: 1, fg: FG, bg: BG, charset: BLOCKS,
      cellWidth: 8, cellHeight: 8,
    })
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      expect(isFg(pixelAt(img, x, y))).toBe(true)
    }
  })

  it("zero intensity leaves the cell as background", () => {
    const img = renderToImagePixels({
      intensities: new Float32Array(4 * 4), srcWidth: 4, srcHeight: 4,
      destWidth: 1, destHeight: 1, fg: FG, bg: BG, charset: BLOCKS,
      cellWidth: 8, cellHeight: 8,
    })
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      expect(isBg(pixelAt(img, x, y))).toBe(true)
    }
  })

  it("upper-half block: top half fg, bottom half bg", () => {
    // Field with top half = 1, bottom half = 0 → glyphfit picks U+2580 for BLOCKS.
    const W = 1, H = 1, srcW = 8, srcH = 8
    const f = new Float32Array(srcW * srcH)
    for (let y = 0; y < srcH / 2; y++) for (let x = 0; x < srcW; x++) f[y * srcW + x] = 1
    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: BLOCKS,
      cellWidth: 16, cellHeight: 16,
    })
    expect(isFg(pixelAt(img, 8, 2))).toBe(true)    // top half
    expect(isBg(pixelAt(img, 8, 14))).toBe(true)   // bottom half
  })

  it("braille encodes dot positions", () => {
    // Manual: render U+2801 (dot 1 = top-left). Use a tiny field that maps to
    // matchField producing U+2801 — easiest to build a charset of just that
    // entry so the match always returns it.
    const W = 1, H = 1, srcW = 8, srcH = 8
    const f = new Float32Array(srcW * srcH)
    // Top-left strong, rest empty → braille selects something with d1 set.
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) f[y * srcW + x] = 1

    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: BRAILLE,
      cellWidth: 32, cellHeight: 64,
    })
    // Some pixels in the top-left quadrant should be fg (the dot).
    let topLeftFgCount = 0
    for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++) {
      if (isFg(pixelAt(img, x, y))) topLeftFgCount++
    }
    expect(topLeftFgCount).toBeGreaterThan(0)
    // The bottom-right quadrant should be entirely bg.
    for (let y = 40; y < 64; y++) for (let x = 20; x < 32; x++) {
      expect(isBg(pixelAt(img, x, y))).toBe(true)
    }
  })

  it("shade chars produce blended pixel values", () => {
    const W = 1, H = 1, srcW = 4, srcH = 4
    const f = new Float32Array(srcW * srcH)
    f.fill(0.5)   // → U+2592 medium shade with BLOCKS_SHADE
    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: BLOCKS_SHADE,
      cellWidth: 8, cellHeight: 8,
    })
    // Every pixel should be a mid-grey (fg=255 white blended ~50% with bg=0 black).
    const p = pixelAt(img, 4, 4)
    expect(p[0]).toBeGreaterThan(60)
    expect(p[0]).toBeLessThan(200)
    expect(p[0]).toBe(p[1])  // grey
    expect(p[1]).toBe(p[2])
  })

  it("box ─ (light horizontal) draws a stripe at vertical mid", () => {
    const W = 1, H = 1, srcW = 8, srcH = 8
    // Strong mid row → BOX picks U+2500.
    const f = new Float32Array(srcW * srcH)
    for (let y = 3; y < 5; y++) for (let x = 0; x < srcW; x++) f[y * srcW + x] = 1
    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: BOX,
      cellWidth: 32, cellHeight: 32,
    })
    // Mid row should have fg pixels; top and bottom rows should be bg.
    let midFgCount = 0
    for (let x = 0; x < 32; x++) if (isFg(pixelAt(img, x, 16))) midFgCount++
    expect(midFgCount).toBeGreaterThan(20)
    for (let x = 0; x < 32; x++) expect(isBg(pixelAt(img, x, 2))).toBe(true)
    for (let x = 0; x < 32; x++) expect(isBg(pixelAt(img, x, 30))).toBe(true)
  })

  it("ASCII char falls back to ShapeVector 2×3 fill (no font dep)", () => {
    // Use a strong asymmetric input that matches a directional ASCII char.
    const W = 1, H = 1, srcW = 8, srcH = 8
    const f = new Float32Array(srcW * srcH).fill(0.5)
    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: ASCII,
      cellWidth: 16, cellHeight: 16,
    })
    // Some pixels in the cell should be neither pure bg nor pure fg
    // (intensity-blended fill).
    let blendedCount = 0
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const p = pixelAt(img, x, y)
      if (p[0] > 0 && p[0] < 255) blendedCount++
    }
    expect(blendedCount).toBeGreaterThan(0)
  })
})

describe("renderToImagePixels — palette modulation", () => {
  it("applies intensityToFg per-cell", () => {
    const W = 2, H = 1, srcW = 8, srcH = 4
    const f = new Float32Array(srcW * srcH)
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < 4; x++) f[y * srcW + x] = 0.2     // dark left
      for (let x = 4; x < srcW; x++) f[y * srcW + x] = 1.0  // bright right
    }
    const img = renderToImagePixels({
      intensities: f, srcWidth: srcW, srcHeight: srcH,
      destWidth: W, destHeight: H, fg: FG, bg: BG, charset: BLOCKS_SHADE,
      cellWidth: 16, cellHeight: 16,
      intensityToFg: paletteFg(FIRE),
    })
    // Left cell at intensity 0.2 → dark red; right cell at intensity 1.0 → near-white.
    const leftPx  = pixelAt(img, 8,  8)
    const rightPx = pixelAt(img, 24, 8)
    // Left is more red than green/blue.
    expect(leftPx[0]).toBeGreaterThan(leftPx[1])
    expect(leftPx[0]).toBeGreaterThan(leftPx[2])
    // Right is much brighter overall than left.
    const leftLum  = 0.299 * leftPx[0]  + 0.587 * leftPx[1]  + 0.114 * leftPx[2]
    const rightLum = 0.299 * rightPx[0] + 0.587 * rightPx[1] + 0.114 * rightPx[2]
    expect(rightLum).toBeGreaterThan(leftLum + 60)
  })
})
