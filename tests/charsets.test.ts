import { describe, it, expect } from "bun:test"
import { BRAILLE } from "../src/charsets/braille.ts"
import { SHADE, BLOCKS, BLOCKS_SHADE } from "../src/charsets/blocks.ts"
import { BOX } from "../src/charsets/box.ts"
import { ASCII } from "../src/charsets/ascii.ts"
import { findBestChar, svDistance } from "../src/shape-vector.ts"
import { compileCharset } from "../src/compiled-charset.ts"
import { shapeOf, buildCharset } from "../src/index.ts"
import { InvalidCharsetError } from "../src/errors.ts"
import type { ShapeVector, Charset } from "../src/types.ts"

/* ──────────────────────────────────────────────────────────────────────── */
/*  Structural invariants — every charset, every entry                      */
/*                                                                          */
/*  These would have caught the 0.43-vs-0x43 bug and the duplicate U+2584.  */
/* ──────────────────────────────────────────────────────────────────────── */

const ALL_CHARSETS: Array<[string, Charset]> = [
  ["BRAILLE",      BRAILLE],
  ["SHADE",        SHADE],
  ["BLOCKS",       BLOCKS],
  ["BLOCKS_SHADE", BLOCKS_SHADE],
  ["BOX",          BOX],
  ["ASCII",        ASCII],
]

describe.each(ALL_CHARSETS)("%s — structural invariants", (_name, cs) => {
  it("is non-empty", () => {
    expect(cs.length).toBeGreaterThan(0)
  })

  it("every codepoint is a non-negative integer", () => {
    for (const e of cs) {
      expect(Number.isInteger(e.codepoint)).toBe(true)
      expect(e.codepoint).toBeGreaterThanOrEqual(0)
    }
  })

  it("every codepoint is in the valid Unicode range (0..0x10FFFF)", () => {
    for (const e of cs) {
      expect(e.codepoint).toBeLessThanOrEqual(0x10FFFF)
    }
  })

  it("no duplicate codepoints", () => {
    const seen = new Set<number>()
    for (const e of cs) {
      expect(seen.has(e.codepoint)).toBe(false)
      seen.add(e.codepoint)
    }
  })

  it("ShapeVector has exactly 6 components", () => {
    for (const e of cs) {
      expect(e.sv.length).toBe(6)
    }
  })

  it("every ShapeVector component is a finite number in [0, 1]", () => {
    for (const e of cs) {
      for (const v of e.sv) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it("compiles without error", () => {
    expect(() => compileCharset(cs)).not.toThrow()
  })

  it("every entry round-trips through findBestChar (its own SV finds itself or an alias)", () => {
    // An exact match always exists (the entry itself), so the result's SV
    // must equal the query SV — even when multiple entries share the same SV.
    for (const e of cs) {
      const r = findBestChar([...e.sv] as ShapeVector, cs)
      expect(svDistance(r.sv, e.sv)).toBeLessThan(1e-10)
    }
  })
})

/* ─── Charset-specific tests ──────────────────────────────────────────── */

describe("BRAILLE charset", () => {
  it("contains exactly 256 entries", () => {
    expect(BRAILLE.length).toBe(256)
  })

  it("all codepoints lie in U+2800..U+28FF", () => {
    for (const { codepoint } of BRAILLE) {
      expect(codepoint).toBeGreaterThanOrEqual(0x2800)
      expect(codepoint).toBeLessThanOrEqual(0x28FF)
    }
  })

  it("U+2800 (no dots) has zero ShapeVector", () => {
    const e = BRAILLE.find(x => x.codepoint === 0x2800)!
    expect(e.sv).toEqual([0, 0, 0, 0, 0, 0])
  })

  it("U+28FF (all dots) has all-ones ShapeVector", () => {
    const e = BRAILLE.find(x => x.codepoint === 0x28FF)!
    for (const v of e.sv) expect(v).toBeCloseTo(1, 5)
  })

  it("U+2801 (dot 1 only) has top-left signal only", () => {
    const e = BRAILLE.find(x => x.codepoint === 0x2801)!
    expect(e.sv[0]).toBe(1)
    expect(e.sv[1]).toBe(0)
    expect(e.sv[2]).toBe(0)
    expect(e.sv[4]).toBe(0)
  })
})

describe("BLOCKS charset", () => {
  it("contains space and full block", () => {
    const cps = BLOCKS.map(e => e.codepoint)
    expect(cps).toContain(0x0020)
    expect(cps).toContain(0x2588)
  })

  it("space (U+0020) has zero SV", () => {
    const e = BLOCKS.find(x => x.codepoint === 0x0020)!
    expect(e.sv).toEqual([0, 0, 0, 0, 0, 0])
  })

  it("full block (U+2588) has all-ones SV", () => {
    const e = BLOCKS.find(x => x.codepoint === 0x2588)!
    for (const v of e.sv) expect(v).toBe(1)
  })

  it("upper half (U+2580) has top row signal only", () => {
    const e = BLOCKS.find(x => x.codepoint === 0x2580)!
    expect(e.sv[0]).toBe(1)
    expect(e.sv[1]).toBe(1)
    expect(e.sv[4]).toBe(0)
    expect(e.sv[5]).toBe(0)
  })

  it("left half (U+258C) has left column signal only", () => {
    const e = BLOCKS.find(x => x.codepoint === 0x258C)!
    expect(e.sv[0]).toBe(1)
    expect(e.sv[1]).toBe(0)
    expect(e.sv[2]).toBe(1)
    expect(e.sv[3]).toBe(0)
  })

  it("U+2584 appears exactly once (regression: had been duplicated)", () => {
    const matches = BLOCKS.filter(e => e.codepoint === 0x2584)
    expect(matches.length).toBe(1)
  })
})

describe("SHADE charset", () => {
  it("has exactly 4 entries", () => {
    expect(SHADE.length).toBe(4)
  })

  it("entries are ordered by density: space < ░ < ▒ < ▓", () => {
    const avg = (sv: ShapeVector) => sv.reduce((s, v) => s + v, 0) / 6
    const space  = SHADE.find(e => e.codepoint === 0x0020)!.sv
    const light  = SHADE.find(e => e.codepoint === 0x2591)!.sv
    const medium = SHADE.find(e => e.codepoint === 0x2592)!.sv
    const dark   = SHADE.find(e => e.codepoint === 0x2593)!.sv
    expect(avg(space)).toBeLessThan(avg(light))
    expect(avg(light)).toBeLessThan(avg(medium))
    expect(avg(medium)).toBeLessThan(avg(dark))
  })
})

describe("BLOCKS_SHADE charset", () => {
  it("contains every codepoint from BLOCKS and SHADE", () => {
    const cps = new Set(BLOCKS_SHADE.map(e => e.codepoint))
    for (const e of BLOCKS) expect(cps.has(e.codepoint)).toBe(true)
    for (const e of SHADE) expect(cps.has(e.codepoint)).toBe(true)
  })
})

describe("BOX charset", () => {
  it("horizontal line ─ has stronger mid row than top/bot", () => {
    const e = BOX.find(x => x.codepoint === 0x2500)!
    const mid = (e.sv[2]! + e.sv[3]!) / 2
    const top = (e.sv[0]! + e.sv[1]!) / 2
    const bot = (e.sv[4]! + e.sv[5]!) / 2
    expect(mid).toBeGreaterThan(top)
    expect(mid).toBeGreaterThan(bot)
  })

  it("/ has stronger top-right and bot-left than top-left and bot-right", () => {
    const e = BOX.find(x => x.codepoint === 0x2571)!
    expect(e.sv[1]).toBeGreaterThan(e.sv[0]!)
    expect(e.sv[4]).toBeGreaterThan(e.sv[5]!)
  })

  it("\\ has stronger top-left and bot-right", () => {
    const e = BOX.find(x => x.codepoint === 0x2572)!
    expect(e.sv[0]).toBeGreaterThan(e.sv[1]!)
    expect(e.sv[5]).toBeGreaterThan(e.sv[4]!)
  })
})

describe("ASCII charset", () => {
  it("contains space and is exactly 95 entries (printable ASCII)", () => {
    expect(ASCII.some(e => e.codepoint === 0x20)).toBe(true)
    expect(ASCII.length).toBe(95)
  })

  it("all codepoints lie in 0x20..0x7E (regression: 'C' was 0.43 not 0x43)", () => {
    for (const { codepoint } of ASCII) {
      expect(codepoint).toBeGreaterThanOrEqual(0x20)
      expect(codepoint).toBeLessThanOrEqual(0x7E)
    }
  })

  it("contains 'C' at codepoint 0x43 (regression)", () => {
    expect(ASCII.some(e => e.codepoint === 0x43)).toBe(true)
  })

  it("/ has top-right > top-left", () => {
    const e = ASCII.find(x => x.codepoint === 0x2F)!
    expect(e.sv[1]).toBeGreaterThan(e.sv[0]!)
  })

  it("- has mid-row signal stronger than top/bot", () => {
    const e = ASCII.find(x => x.codepoint === 0x2D)!
    const mid = (e.sv[2]! + e.sv[3]!) / 2
    expect(mid).toBeGreaterThan((e.sv[0]! + e.sv[1]!) / 2)
    expect(mid).toBeGreaterThan((e.sv[4]! + e.sv[5]!) / 2)
  })

  it("_ has bot-row signal stronger than top", () => {
    const e = ASCII.find(x => x.codepoint === 0x5F)!
    expect((e.sv[4]! + e.sv[5]!) / 2).toBeGreaterThan((e.sv[0]! + e.sv[1]!) / 2)
  })
})

/* ─── shapeOf ─────────────────────────────────────────────────────────── */

describe("shapeOf", () => {
  it("returns a ShapeVector for known codepoints", () => {
    expect(shapeOf(0x2580)).toBeDefined()  // ▀
    expect(shapeOf(0x2800)).toBeDefined()  // empty braille
    expect(shapeOf(0x2500)).toBeDefined()  // ─
    expect(shapeOf(0x2F)).toBeDefined()    // /
    expect(shapeOf(0x43)).toBeDefined()    // C — regression
  })

  it("returns undefined for unknown codepoints", () => {
    expect(shapeOf(0x1F600)).toBeUndefined()  // emoji
    expect(shapeOf(0x4E2D)).toBeUndefined()   // CJK
    expect(shapeOf(-1)).toBeUndefined()
  })

  it("matches the BLOCKS U+2588 entry exactly", () => {
    const sv = shapeOf(0x2588)!
    for (const v of sv) expect(v).toBe(1)
  })
})

/* ─── buildCharset ─────────────────────────────────────────────────────── */

describe("buildCharset", () => {
  it("filters known codepoints", () => {
    const cs = buildCharset([0x2588, 0x2580, 0x2584])
    expect(cs.length).toBe(3)
  })

  it("silently skips unknown codepoints", () => {
    const cs = buildCharset([0x2588, 0x1F600, 0x2580])
    expect(cs.length).toBe(2)
  })

  it("accepts mixed (codepoint | [codepoint, sv]) entries", () => {
    const customSv: ShapeVector = [0, 0, 0.6, 0.6, 0, 0]
    const cs = buildCharset([
      0x2588,                   // built-in
      [0x2022, customSv],       // custom bullet •
    ])
    expect(cs.length).toBe(2)
    const bullet = cs.find(e => e.codepoint === 0x2022)
    expect(bullet?.sv).toEqual(customSv)
  })

  it("the resulting charset compiles", () => {
    const cs = buildCharset([0x2588, 0x2580, 0x2584])
    expect(() => compileCharset(cs)).not.toThrow()
  })
})

/* ─── compileCharset & error paths ────────────────────────────────────── */

describe("compileCharset", () => {
  it("throws InvalidCharsetError on empty input", () => {
    expect(() => compileCharset([])).toThrow(InvalidCharsetError)
  })

  it("returns the same compiled instance for repeated calls (caching)", () => {
    const a = compileCharset(BRAILLE)
    const b = compileCharset(BRAILLE)
    expect(a).toBe(b)
  })

  it("throws on entries with wrong-length ShapeVector", () => {
    const bad = [Object.freeze({ codepoint: 0x41, sv: [1, 0, 0, 0] as unknown as ShapeVector })]
    expect(() => compileCharset(bad as Charset)).toThrow(InvalidCharsetError)
  })

  it("throws on entries with out-of-range component", () => {
    const bad = [Object.freeze({ codepoint: 0x41, sv: [1.5, 0, 0, 0, 0, 0] as ShapeVector })]
    expect(() => compileCharset(bad as Charset)).toThrow(InvalidCharsetError)
  })

  it("throws on entries with negative codepoint", () => {
    const bad = [Object.freeze({ codepoint: -1, sv: [0, 0, 0, 0, 0, 0] as ShapeVector })]
    expect(() => compileCharset(bad as Charset)).toThrow(InvalidCharsetError)
  })
})
