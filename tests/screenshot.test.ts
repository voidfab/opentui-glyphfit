import { describe, it, expect } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  renderToText, renderToAnsi, renderToHtml, renderAllFormats,
  BLOCKS_SHADE, BLOCKS, paletteFg, paletteFromHex,
} from "../src/index.ts"
import { InvalidFieldError, InvalidOptionsError } from "../src/errors.ts"

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

function fullField(W: number, H: number): Float32Array {
  const f = new Float32Array(W * H)
  f.fill(1)
  return f
}

describe("renderToText", () => {
  it("returns destHeight rows separated by \\n with trailing \\n", () => {
    const text = renderToText({
      intensities: fullField(6, 6), srcWidth: 6, srcHeight: 6,
      destWidth: 2, destHeight: 2, fg: FG, bg: BG, charset: BLOCKS,
    })
    const rows = text.split("\n")
    expect(rows).toHaveLength(3)        // 2 rows + trailing empty after final \n
    expect(rows[0]!.length).toBe(2)
    expect(rows[1]!.length).toBe(2)
    expect(rows[2]).toBe("")
  })

  it("full-intensity input + BLOCKS \u2192 row of \u2588", () => {
    const text = renderToText({
      intensities: fullField(8, 6), srcWidth: 8, srcHeight: 6,
      destWidth: 4, destHeight: 2, fg: FG, bg: BG, charset: BLOCKS,
    })
    expect(text.startsWith("\u2588\u2588\u2588\u2588")).toBe(true)
  })

  it("zero-intensity input \u2192 all spaces", () => {
    const text = renderToText({
      intensities: new Float32Array(8 * 6), srcWidth: 8, srcHeight: 6,
      destWidth: 4, destHeight: 2, fg: FG, bg: BG,
    })
    for (const line of text.split("\n").slice(0, -1)) {
      expect(line).toBe("    ")
    }
  })
})

describe("renderToAnsi", () => {
  it("contains 24-bit colour escapes", () => {
    const ansi = renderToAnsi({
      intensities: fullField(6, 6), srcWidth: 6, srcHeight: 6,
      destWidth: 2, destHeight: 2,
      fg: RGBA.fromValues(1, 0.5, 0.25, 1), bg: BG, charset: BLOCKS,
    })
    expect(ansi).toContain("\x1b[38;2;255;128;64m")    // fg
    expect(ansi).toContain("\x1b[48;2;0;0;0m")         // bg
    expect(ansi).toContain("\x1b[0m")                  // reset
  })

  it("ends every visual row with a reset escape", () => {
    const ansi = renderToAnsi({
      intensities: fullField(4, 4), srcWidth: 4, srcHeight: 4,
      destWidth: 2, destHeight: 2, fg: FG, bg: BG, charset: BLOCKS,
    })
    const rows = ansi.split("\n").slice(0, -1)        // drop trailing empty
    for (const row of rows) expect(row.endsWith("\x1b[0m")).toBe(true)
  })

  it("modulates fg when intensityToFg is set", () => {
    const pal = paletteFg(paletteFromHex(["#ff0000", "#00ff00"]))
    const ansi = renderToAnsi({
      intensities: fullField(4, 4), srcWidth: 4, srcHeight: 4,
      destWidth: 2, destHeight: 2, fg: FG, bg: BG, charset: BLOCKS,
      intensityToFg: pal,
    })
    // Full intensity \u2192 palette right edge \u2192 (0,255,0).
    expect(ansi).toContain("\x1b[38;2;0;255;0m")
  })
})

describe("renderToHtml", () => {
  it("produces a complete HTML document with <pre> and per-cell <span>s", () => {
    const html = renderToHtml({
      intensities: fullField(6, 6), srcWidth: 6, srcHeight: 6,
      destWidth: 3, destHeight: 2,
      fg: RGBA.fromValues(1, 0.5, 0.25, 1), bg: BG, charset: BLOCKS,
    })
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("<pre>")
    expect(html).toContain("</pre>")
    expect(html).toContain("rgb(255,128,64)")  // fg
    expect(html).toContain("rgb(0,0,0)")       // bg
    expect(html).toContain("\u2588")           // full block char appears
  })

  it("escapes HTML metacharacters in the title and char stream", () => {
    const html = renderToHtml({
      // ASCII charset includes <, >, &, ", '. Force one of them by making the
      // SV match exactly: pure mid-row signal \u2192 '-' character.
      intensities: (() => { const f = new Float32Array(4 * 4); for (let i = 4; i < 12; i++) f[i] = 1; return f })(),
      srcWidth: 4, srcHeight: 4,
      destWidth: 1, destHeight: 1,
      fg: FG, bg: BG, charset: BLOCKS_SHADE,
    }, { title: "<dangerous & quoted 'title'>" })

    expect(html).toContain("&lt;dangerous &amp; quoted &#39;title&#39;&gt;")
    // <pre> body, after stripping legitimate <span...> tags, must not contain
    // raw HTML metacharacters from the rendered cells.
    const body = html.split("<pre>")[1]!.split("</pre>")[0]!
    const stripped = body.replace(/<\/?span[^>]*>/g, "")
    expect(stripped).not.toMatch(/<(?!\/?span)/)
    expect(stripped).not.toMatch(/&(?!(?:lt|gt|amp|quot|#39);)/)
  })

  it("custom font-family + font-size land in the stylesheet", () => {
    const html = renderToHtml({
      intensities: fullField(4, 4), srcWidth: 4, srcHeight: 4,
      destWidth: 2, destHeight: 1, fg: FG, bg: BG, charset: BLOCKS,
    }, { fontFamily: "Comic Sans MS, monospace", fontSize: "20px" })
    expect(html).toContain("font-family: Comic Sans MS, monospace")
    expect(html).toContain("font-size: 20px")
  })

  it("renders ALL three formats consistently via renderAllFormats", () => {
    const opts = {
      intensities: fullField(6, 6), srcWidth: 6, srcHeight: 6,
      destWidth: 2, destHeight: 2, fg: FG, bg: BG, charset: BLOCKS,
    }
    const all = renderAllFormats(opts)
    expect(all.txt).toBe(renderToText(opts))
    expect(all.ansi).toBe(renderToAnsi(opts))
    expect(all.html).toBe(renderToHtml(opts))
  })
})

describe("validation", () => {
  it("renderToText throws InvalidFieldError on length mismatch", () => {
    expect(() => renderToText({
      intensities: new Float32Array(0), srcWidth: 2, srcHeight: 2,
      destWidth: 1, destHeight: 1, fg: FG, bg: BG,
    })).toThrow(InvalidFieldError)
  })

  it("renderToHtml throws InvalidOptionsError on destWidth <= 0", () => {
    expect(() => renderToHtml({
      intensities: new Float32Array(4), srcWidth: 2, srcHeight: 2,
      destWidth: 0, destHeight: 1, fg: FG, bg: BG,
    })).toThrow(InvalidOptionsError)
  })

  it("throws InvalidOptionsError on empty charset", () => {
    expect(() => renderToText({
      intensities: new Float32Array(4), srcWidth: 2, srcHeight: 2,
      destWidth: 1, destHeight: 1, fg: FG, bg: BG, charset: [],
    })).toThrow(InvalidOptionsError)
  })
})

describe("intensityToFg per-cell isolation", () => {
  it("captures distinct colours per cell even though paletteFg reuses a scratch RGBA", () => {
    // 2 cells horizontally: left at intensity 0.2, right at 1.0.
    const f = new Float32Array(4 * 2)
    for (let y = 0; y < 2; y++) {
      f[y * 4 + 0] = 0.2; f[y * 4 + 1] = 0.2
      f[y * 4 + 2] = 1.0; f[y * 4 + 3] = 1.0
    }
    const pal = paletteFg(paletteFromHex(["#000000", "#ff0000"]))
    const ansi = renderToAnsi({
      intensities: f, srcWidth: 4, srcHeight: 2,
      destWidth: 2, destHeight: 1, fg: FG, bg: BG, charset: BLOCKS_SHADE,
      intensityToFg: pal,
    })
    // Two distinct fg escapes should appear: dark-red and pure red.
    const fgEscapes = ansi.match(/\x1b\[38;2;\d+;\d+;\d+m/g) ?? []
    const distinct = new Set(fgEscapes)
    expect(distinct.size).toBeGreaterThanOrEqual(2)
  })
})
