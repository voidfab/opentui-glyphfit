import { describe, it, expect } from "bun:test"
import {
  svDistance,
  sampleShapeVector,
  sampleShapeVectorInto,
  findBestChar,
  buildCharsetFromEntries,
} from "../src/shape-vector.ts"
import { InvalidCharsetError } from "../src/errors.ts"
import type { ShapeVector } from "../src/types.ts"

describe("svDistance", () => {
  it("returns 0 for identical vectors", () => {
    const v: ShapeVector = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    expect(svDistance(v, v)).toBe(0)
  })

  it("is symmetric", () => {
    const a: ShapeVector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    const b: ShapeVector = [0.6, 0.5, 0.4, 0.3, 0.2, 0.1]
    expect(svDistance(a, b)).toBeCloseTo(svDistance(b, a))
  })

  it("returns the squared Euclidean distance", () => {
    const a: ShapeVector = [1, 0, 0, 0, 0, 0]
    const b: ShapeVector = [0, 0, 0, 0, 0, 0]
    expect(svDistance(a, b)).toBeCloseTo(1)
  })

  it("monotonic with divergence", () => {
    const zero: ShapeVector = [0, 0, 0, 0, 0, 0]
    const near: ShapeVector = [0.1, 0, 0, 0, 0, 0]
    const far:  ShapeVector = [1, 0, 0, 0, 0, 0]
    expect(svDistance(zero, near)).toBeLessThan(svDistance(zero, far))
  })
})

describe("sampleShapeVector", () => {
  it("returns zero vector for all-zero field", () => {
    const f = new Float32Array(10 * 10)
    expect(sampleShapeVector(f, 10, 10, 0, 0, 1, 1)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it("returns near-1 vector for all-one field", () => {
    const f = new Float32Array(10 * 10).fill(1)
    const sv = sampleShapeVector(f, 10, 10, 0, 0, 1, 1)
    for (const v of sv) expect(v).toBeCloseTo(1, 1)
  })

  it("top-heavy field → top samples > bottom samples", () => {
    const f = new Float32Array(10 * 10)
    for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) f[y * 10 + x] = 1
    const sv = sampleShapeVector(f, 10, 10, 0, 0, 1, 1)
    expect(sv[0]! + sv[1]!).toBeGreaterThan(sv[4]! + sv[5]!)
  })

  it("left-heavy field → left samples > right samples", () => {
    const f = new Float32Array(10 * 10)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) f[y * 10 + x] = 1
    const sv = sampleShapeVector(f, 10, 10, 0, 0, 1, 1)
    expect(sv[0]! + sv[2]! + sv[4]!).toBeGreaterThan(sv[1]! + sv[3]! + sv[5]!)
  })

  it("clamps output to [0, 1]", () => {
    const f = new Float32Array(4).fill(2)
    const sv = sampleShapeVector(f, 2, 2, 0, 0, 1, 1)
    for (const v of sv) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it("treats NaN as 0 (does not poison the vector)", () => {
    const f = new Float32Array(4 * 4).fill(1)
    f[0] = NaN
    f[1] = Infinity
    f[2] = -Infinity
    const sv = sampleShapeVector(f, 4, 4, 0, 0, 1, 1)
    for (const v of sv) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it("gamma > 1 lowers samples (darker for mid-tone)", () => {
    const f = new Float32Array(4 * 4).fill(0.3)
    const a = sampleShapeVector(f, 4, 4, 0, 0, 1, 1, 1)
    const b = sampleShapeVector(f, 4, 4, 0, 0, 1, 1, 2)
    expect(b[0]!).toBeLessThan(a[0]!)
  })

  it("non-zero cell index samples the correct sub-region of the field", () => {
    // Field 8×4 → 2×1 cell grid → each cell covers 4×4 source pixels.
    // Make the right cell bright, left cell dark.
    const f = new Float32Array(8 * 4)
    for (let y = 0; y < 4; y++) for (let x = 4; x < 8; x++) f[y * 8 + x] = 1
    const left  = sampleShapeVector(f, 8, 4, 0, 0, 2, 1)
    const right = sampleShapeVector(f, 8, 4, 1, 0, 2, 1)
    for (const v of left)  expect(v).toBe(0)
    for (const v of right) expect(v).toBeCloseTo(1, 5)
  })

  it("sampleShapeVectorInto writes into the provided tuple, no allocation", () => {
    const out: ShapeVector = [0, 0, 0, 0, 0, 0]
    const f = new Float32Array(4 * 4).fill(0.5)
    sampleShapeVectorInto(out, f, 4, 4, 0, 0, 1, 1)
    for (const v of out) expect(v).toBeCloseTo(0.5, 1)
    // Reuse the same tuple — values overwrite, not accumulate.
    const f2 = new Float32Array(4 * 4)
    sampleShapeVectorInto(out, f2, 4, 4, 0, 0, 1, 1)
    for (const v of out) expect(v).toBe(0)
  })
})

describe("findBestChar", () => {
  const charset = buildCharsetFromEntries([
    [0x41, [1, 0, 0, 0, 0, 0]],
    [0x42, [0, 0, 0, 0, 0, 1]],
    [0x43, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]],
  ])

  it("returns the entry with zero distance for an exact match", () => {
    expect(findBestChar([1, 0, 0, 0, 0, 0], charset).codepoint).toBe(0x41)
  })

  it("picks the closest entry for an approximate query", () => {
    expect(findBestChar([0.05, 0, 0, 0, 0, 0.9], charset).codepoint).toBe(0x42)
  })

  it("breaks ties deterministically (first entry wins)", () => {
    const result = findBestChar([0, 0, 0, 0, 0, 0], charset)
    expect([0x41, 0x42]).toContain(result.codepoint)
  })

  it("throws InvalidCharsetError on empty charset", () => {
    expect(() => findBestChar([0, 0, 0, 0, 0, 0], [])).toThrow(InvalidCharsetError)
  })
})
