import { describe, it, expect } from "bun:test"
import { intensityFromPixels, resampleIntensity } from "../src/image.ts"
import { InvalidFieldError } from "../src/errors.ts"

describe("intensityFromPixels — RGBA input", () => {
  // 2×2 image: white, black, red, full-blue
  function rgba2x2(): Uint8Array {
    return new Uint8Array([
      255, 255, 255, 255,
        0,   0,   0, 255,
      255,   0,   0, 255,
        0,   0, 255, 255,
    ])
  }

  it("rec709: white > red > blue > black", () => {
    const f = intensityFromPixels(rgba2x2(), 2, 2)
    expect(f[0]).toBeCloseTo(1, 2)                           // white
    expect(f[1]).toBeCloseTo(0, 2)                           // black
    expect(f[2]).toBeCloseTo(0.2126, 3)                      // pure red
    expect(f[3]).toBeCloseTo(0.0722, 3)                      // pure blue
  })

  it("rec601: red is brighter than rec709", () => {
    const f709 = intensityFromPixels(rgba2x2(), 2, 2, { luminance: "rec709" })
    const f601 = intensityFromPixels(rgba2x2(), 2, 2, { luminance: "rec601" })
    expect(f601[2]!).toBeGreaterThan(f709[2]!)
  })

  it("average: red gives 1/3", () => {
    const f = intensityFromPixels(rgba2x2(), 2, 2, { luminance: "average" })
    expect(f[2]).toBeCloseTo(1 / 3, 2)
  })

  it("max: red gives 1", () => {
    const f = intensityFromPixels(rgba2x2(), 2, 2, { luminance: "max" })
    expect(f[2]).toBeCloseTo(1, 2)
  })

  it("alpha: extracts the alpha channel", () => {
    const px = new Uint8Array([0, 0, 0, 0,   0, 0, 0, 128,  0, 0, 0, 255,  0, 0, 0, 64])
    const f = intensityFromPixels(px, 2, 2, { luminance: "alpha" })
    expect(f[0]).toBeCloseTo(0)
    expect(f[1]).toBeCloseTo(128 / 255, 2)
    expect(f[2]).toBeCloseTo(1)
    expect(f[3]).toBeCloseTo(64 / 255, 2)
  })

  it("invert: 1 - x", () => {
    const f = intensityFromPixels(rgba2x2(), 2, 2, { invert: true })
    expect(f[0]).toBeCloseTo(0, 2)  // white inverted
    expect(f[1]).toBeCloseTo(1, 2)  // black inverted
  })

  it("gamma > 1 darkens mid-tones", () => {
    const px = new Uint8Array([128, 128, 128, 255])
    const a = intensityFromPixels(px, 1, 1, { gamma: 1 })
    const b = intensityFromPixels(px, 1, 1, { gamma: 2 })
    expect(b[0]!).toBeLessThan(a[0]!)
  })

  it("premultiplyAlpha multiplies result by alpha channel", () => {
    const px = new Uint8Array([255, 255, 255, 128])
    const a = intensityFromPixels(px, 1, 1, { premultiplyAlpha: false })
    const b = intensityFromPixels(px, 1, 1, { premultiplyAlpha: true })
    expect(a[0]).toBeCloseTo(1, 2)
    expect(b[0]).toBeCloseTo(128 / 255, 2)
  })

  it("output values are clamped to [0, 1]", () => {
    const f = intensityFromPixels(rgba2x2(), 2, 2)
    for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe("intensityFromPixels — RGB and greyscale input", () => {
  it("3-channel RGB", () => {
    const px = new Uint8Array([255, 255, 255,  0, 0, 0,  255, 0, 0,  0, 0, 255])
    const f = intensityFromPixels(px, 2, 2, { channels: 3 })
    expect(f[0]).toBeCloseTo(1, 2)
    expect(f[1]).toBeCloseTo(0)
  })

  it("1-channel greyscale", () => {
    const px = new Uint8Array([0, 64, 128, 255])
    const f = intensityFromPixels(px, 2, 2, { channels: 1 })
    expect(f[0]).toBeCloseTo(0)
    expect(f[3]).toBeCloseTo(1, 2)
  })
})

describe("intensityFromPixels — validation", () => {
  it("throws on size mismatch", () => {
    expect(() => intensityFromPixels(new Uint8Array(8), 2, 2)).toThrow(InvalidFieldError)
  })

  it("throws on non-positive width", () => {
    expect(() => intensityFromPixels(new Uint8Array(0), 0, 2)).toThrow(InvalidFieldError)
  })

  it("throws on bad gamma", () => {
    expect(() => intensityFromPixels(new Uint8Array(4), 1, 1, { gamma: 0 })).toThrow(InvalidFieldError)
    expect(() => intensityFromPixels(new Uint8Array(4), 1, 1, { gamma: -1 })).toThrow(InvalidFieldError)
    expect(() => intensityFromPixels(new Uint8Array(4), 1, 1, { gamma: NaN })).toThrow(InvalidFieldError)
  })
})

describe("resampleIntensity", () => {
  it("identity resample preserves values", () => {
    const src = new Float32Array([0, 0.25, 0.5, 0.75])
    const out = resampleIntensity(src, 2, 2, 2, 2)
    for (let i = 0; i < 4; i++) expect(out[i]).toBeCloseTo(src[i]!, 5)
  })

  it("upsample preserves edge values via bilinear interp", () => {
    const src = new Float32Array([0, 1, 0, 1])
    const out = resampleIntensity(src, 2, 2, 4, 4)
    expect(out[0]).toBeCloseTo(0, 2)             // top-left corner
    expect(out[3]).toBeCloseTo(1, 2)             // top-right corner
    // mid-row should interpolate
    expect(out[2]).toBeGreaterThan(out[0]!)
    expect(out[2]).toBeLessThan(out[3]!)
  })

  it("downsample averages over source neighborhood", () => {
    // 4x4 with a left half = 0, right half = 1.
    const src = new Float32Array(16)
    for (let y = 0; y < 4; y++) for (let x = 2; x < 4; x++) src[y * 4 + x] = 1
    const out = resampleIntensity(src, 4, 4, 2, 2)
    expect(out[0]).toBeCloseTo(0, 2)             // top-left dst — sampled from left half
    expect(out[1]).toBeCloseTo(1, 2)             // top-right dst — sampled from right half
  })

  it("throws on length mismatch", () => {
    expect(() => resampleIntensity(new Float32Array(3), 2, 2, 4, 4)).toThrow(InvalidFieldError)
  })
})
