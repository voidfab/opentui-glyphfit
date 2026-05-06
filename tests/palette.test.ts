import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  makePalette, paletteFromHex, paletteFromValues,
  samplePaletteInto, paletteFg,
  FIRE, OCEAN, SYNTHWAVE, PHOSPHOR, INFERNO, VIRIDIS, GRAYSCALE,
} from "../src/palette.ts"
import { drawGlyphFit, BLOCKS_SHADE } from "../src/index.ts"
import { InvalidOptionsError } from "../src/errors.ts"
import type { BufferLike } from "../src/types.ts"

describe("palette construction", () => {
  it("paletteFromHex returns RGBA[]", () => {
    const p = paletteFromHex(["#000", "#fff"])
    expect(p.length).toBe(2)
    expect(p[0]).toBeInstanceOf(RGBA)
  })

  it("paletteFromValues accepts 3- or 4-tuples", () => {
    const p = paletteFromValues([[0, 0, 0], [1, 1, 1, 0.5]])
    expect(p.length).toBe(2)
    expect(p[1]!.a).toBeCloseTo(0.5)
  })

  it("makePalette throws on < 2 stops", () => {
    expect(() => makePalette([RGBA.fromValues(0, 0, 0, 1)])).toThrow(InvalidOptionsError)
  })

  it("paletteFromHex throws on < 2 stops", () => {
    expect(() => paletteFromHex(["#000"])).toThrow(InvalidOptionsError)
  })
})

describe("samplePaletteInto", () => {
  const p = paletteFromHex(["#000000", "#ff0000", "#ffffff"])
  const out = RGBA.fromValues(0, 0, 0, 1)

  it("t=0 → first stop", () => {
    samplePaletteInto(out, p, 0)
    expect(out.r).toBeCloseTo(0)
    expect(out.g).toBeCloseTo(0)
    expect(out.b).toBeCloseTo(0)
  })

  it("t=1 → last stop", () => {
    samplePaletteInto(out, p, 1)
    expect(out.r).toBeCloseTo(1)
    expect(out.g).toBeCloseTo(1)
    expect(out.b).toBeCloseTo(1)
  })

  it("t=0.5 → middle stop (red)", () => {
    samplePaletteInto(out, p, 0.5)
    expect(out.r).toBeCloseTo(1, 1)
    expect(out.g).toBeCloseTo(0, 1)
    expect(out.b).toBeCloseTo(0, 1)
  })

  it("t=0.25 → halfway between stop 0 and 1 (dark red)", () => {
    samplePaletteInto(out, p, 0.25)
    expect(out.r).toBeCloseTo(0.5, 1)
    expect(out.g).toBeCloseTo(0)
    expect(out.b).toBeCloseTo(0)
  })

  it("clamps t < 0 to first stop", () => {
    samplePaletteInto(out, p, -0.5)
    expect(out.r).toBeCloseTo(0)
  })

  it("clamps t > 1 to last stop", () => {
    samplePaletteInto(out, p, 1.5)
    expect(out.r).toBeCloseTo(1)
  })
})

describe("paletteFg integration with drawGlyphFit", () => {
  it("modulates fg through the palette and reuses the scratch RGBA", () => {
    const buf: BufferLike & { calls: Array<{ char: number; fg: RGBA; bg: RGBA }> } = {
      width: 2, height: 1, calls: [],
      drawChar(char, _x, _y, fg, bg) { this.calls.push({ char, fg, bg }) },
    }
    const W = RGBA.fromValues(1, 1, 1, 1), B = RGBA.fromValues(0, 0, 0, 1)
    const intensities = new Float32Array(4 * 2)
    for (let y = 0; y < 2; y++) {
      intensities[y * 4 + 0] = 0.2
      intensities[y * 4 + 1] = 0.2
      intensities[y * 4 + 2] = 1.0
      intensities[y * 4 + 3] = 1.0
    }
    const pal = paletteFromHex(["#000000", "#ff0000"])
    const fg = paletteFg(pal)

    drawGlyphFit(buf, {
      intensities, srcWidth: 4, srcHeight: 2, x: 0, y: 0,
      fg: W, bg: B, charset: BLOCKS_SHADE,
      intensityToFg: fg,
    })

    // Left cell ~0.2 → dark red; right cell ~1.0 → red. Both share scratch ref.
    expect(buf.calls.length).toBe(2)
    expect(buf.calls[0]!.fg).toBe(buf.calls[1]!.fg)  // same scratch instance
    // Final state of scratch reflects the LAST cell drawn (right, intensity ~1).
    expect(buf.calls[1]!.fg.r).toBeCloseTo(1, 1)
  })

  it("paletteFg throws on < 2 stops", () => {
    expect(() => paletteFg([RGBA.fromValues(0, 0, 0, 1)])).toThrow(InvalidOptionsError)
  })
})

describe("built-in palettes", () => {
  const ALL = [
    ["FIRE", FIRE], ["OCEAN", OCEAN], ["SYNTHWAVE", SYNTHWAVE],
    ["PHOSPHOR", PHOSPHOR], ["INFERNO", INFERNO], ["VIRIDIS", VIRIDIS],
    ["GRAYSCALE", GRAYSCALE],
  ] as const

  it.each(ALL)("%s has \u2265 2 stops", (_n, p) => expect(p.length).toBeGreaterThanOrEqual(2))

  it.each(ALL)("%s sweeps from dark to light at t=0..1", (_n, p) => {
    const a = RGBA.fromValues(0, 0, 0, 1), b = RGBA.fromValues(0, 0, 0, 1)
    samplePaletteInto(a, p, 0)
    samplePaletteInto(b, p, 1)
    const lumA = 0.2126 * a.r + 0.7152 * a.g + 0.0722 * a.b
    const lumB = 0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b
    // All built-ins go from dark → light.
    expect(lumB).toBeGreaterThan(lumA)
  })
})
