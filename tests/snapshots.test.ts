/**
 * Snapshot tests pinning the output of glyphfit against deterministic input
 * fields. These catch regressions in:
 *   - charset definitions (any SV change → different match → snapshot diffs)
 *   - sampling math (area weighting, gamma, threshold)
 *   - char selection (findBestCharIn ordering / tie-breaking)
 *
 * The snapshots are stored as plain UTF-8 strings in `tests/__snapshots__/`.
 * To regenerate after an intentional change: `bun test --update-snapshots`.
 */
import { describe, it, expect } from "bun:test"
import { matchField } from "../src/renderer.ts"
import { BLOCKS_SHADE, BLOCKS, SHADE } from "../src/charsets/blocks.ts"
import { BRAILLE } from "../src/charsets/braille.ts"
import { BOX } from "../src/charsets/box.ts"
import { ASCII } from "../src/charsets/ascii.ts"
import { intensityFromPixels, resampleIntensity } from "../src/image.ts"
import type { Charset } from "../src/types.ts"

/* ────────── Field generators (deterministic) ────────── */

function plasma(srcW: number, srcH: number, t: number): Float32Array {
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

function gradientHorizontal(srcW: number, srcH: number): Float32Array {
  const f = new Float32Array(srcW * srcH)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) f[y * srcW + x] = x / (srcW - 1)
  }
  return f
}

function gradientVertical(srcW: number, srcH: number): Float32Array {
  const f = new Float32Array(srcW * srcH)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) f[y * srcW + x] = y / (srcH - 1)
  }
  return f
}

function diagonalSlash(srcW: number, srcH: number): Float32Array {
  // / shape: 1 along the line y = -x + (srcH-1), feathered.
  const f = new Float32Array(srcW * srcH)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const expectedX = (srcH - 1 - y) * (srcW / srcH)
      const dist = Math.abs(x - expectedX)
      f[y * srcW + x] = Math.max(0, 1 - dist / 2)
    }
  }
  return f
}

function disc(srcW: number, srcH: number): Float32Array {
  const f = new Float32Array(srcW * srcH)
  const cx = srcW / 2, cy = srcH / 2
  const r = Math.min(srcW, srcH) * 0.45
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const d = Math.hypot(x - cx, y - cy) / r
      f[y * srcW + x] = Math.max(0, 1 - d)
    }
  }
  return f
}

/* ────────── Render helper ────────── */

function renderToString(
  field: Float32Array,
  srcW: number, srcH: number,
  destW: number, destH: number,
  charset: Charset,
): string {
  const cps = matchField(field, srcW, srcH, destW, destH, charset)
  const lines: string[] = []
  for (let y = 0; y < destH; y++) {
    let line = ""
    for (let x = 0; x < destW; x++) line += String.fromCodePoint(cps[y * destW + x]!)
    lines.push(line)
  }
  return lines.join("\n")
}

/* ────────── Snapshot tests ────────── */

describe("snapshot — gradients & primitives", () => {
  const W = 24, H = 8
  const srcW = W * 3, srcH = H * 3   // 3× supersample so all 6 sub-regions get pixels.

  it("horizontal gradient, BLOCKS_SHADE", () => {
    const f = gradientHorizontal(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, BLOCKS_SHADE)).toMatchSnapshot()
  })

  it("vertical gradient, BLOCKS_SHADE", () => {
    const f = gradientVertical(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, BLOCKS_SHADE)).toMatchSnapshot()
  })

  it("vertical gradient, SHADE only (4 chars)", () => {
    const f = gradientVertical(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, SHADE)).toMatchSnapshot()
  })

  it("diagonal slash, BOX", () => {
    const f = diagonalSlash(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, BOX)).toMatchSnapshot()
  })

  it("diagonal slash, ASCII", () => {
    const f = diagonalSlash(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, ASCII)).toMatchSnapshot()
  })

  it("disc, BLOCKS", () => {
    const f = disc(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, BLOCKS)).toMatchSnapshot()
  })

  it("disc, BRAILLE", () => {
    const f = disc(srcW, srcH)
    expect(renderToString(f, srcW, srcH, W, H, BRAILLE)).toMatchSnapshot()
  })

  it("plasma t=0.5, BLOCKS_SHADE", () => {
    const f = plasma(srcW, srcH, 0.5)
    expect(renderToString(f, srcW, srcH, W, H, BLOCKS_SHADE)).toMatchSnapshot()
  })

  it("plasma t=0.5, BRAILLE", () => {
    const f = plasma(srcW, srcH, 0.5)
    expect(renderToString(f, srcW, srcH, W, H, BRAILLE)).toMatchSnapshot()
  })
})

describe("snapshot — image → intensity round-trip", () => {
  it("a synthetic 32×16 RGBA gradient image renders predictably", () => {
    const W = 24, H = 8
    const imgW = 32, imgH = 16
    const px = new Uint8Array(imgW * imgH * 4)
    for (let y = 0; y < imgH; y++) {
      for (let x = 0; x < imgW; x++) {
        const i = (y * imgW + x) * 4
        const t = x / (imgW - 1)
        px[i + 0] = Math.round(255 * t)              // red ramp left→right
        px[i + 1] = Math.round(255 * (1 - t))        // green ramp right→left
        px[i + 2] = Math.round(255 * (y / (imgH - 1))) // blue ramp top→bottom
        px[i + 3] = 255
      }
    }
    const intensity = intensityFromPixels(px, imgW, imgH, { luminance: "rec709" })
    const supersampled = resampleIntensity(intensity, imgW, imgH, W * 3, H * 3)
    expect(renderToString(supersampled, W * 3, H * 3, W, H, BLOCKS_SHADE)).toMatchSnapshot()
  })
})
