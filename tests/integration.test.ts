/**
 * Integration tests against a real `OptimizedBuffer` via `@opentui/core/testing`.
 *
 * Mock-buffer tests prove the algorithm is correct; these tests prove the
 * library works end-to-end against the same OpenTUI buffer that real apps use.
 */
import { describe, it, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RGBA } from "@opentui/core"
import { drawGlyphFit } from "../src/renderer.ts"
import { drawGlyphFitColor } from "../src/color-renderer.ts"
import { BLOCKS, BLOCKS_SHADE } from "../src/charsets/blocks.ts"

describe("drawGlyphFit — real OptimizedBuffer", () => {
  it("writes a recognisable disc into the captured frame", async () => {
    const W = 30, H = 12
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: W, height: H })

    const srcW = W * 3, srcH = H * 3
    const f = new Float32Array(srcW * srcH)
    const cx = srcW / 2, cy = srcH / 2, r = Math.min(srcW, srcH) * 0.4
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < srcW; x++) {
        const d = Math.hypot(x - cx, y - cy) / r
        f[y * srcW + x] = Math.max(0, 1 - d)
      }
    }

    renderer.addPostProcessFn((buf) => {
      buf.clear(RGBA.fromValues(0, 0, 0, 1))
      drawGlyphFit(buf, {
        intensities: f, srcWidth: srcW, srcHeight: srcH,
        x: 0, y: 0, destWidth: W, destHeight: H,
        fg: RGBA.fromValues(1, 1, 1, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
        charset: BLOCKS,
      })
    })
    renderer.requestLive()
    await renderOnce()

    const frame = captureCharFrame()
    // The centre row should contain non-space characters (the disc).
    const rows = frame.split("\n")
    const midRow = rows[Math.floor(H / 2)]!
    expect(midRow.replace(/\s/g, "").length).toBeGreaterThan(0)

    // Edge corners should be space.
    expect(rows[0]![0]).toBe(" ")
    expect(rows[H - 1]![W - 1]).toBe(" ")

    renderer.destroy()
  })

  it("writes into a non-zero (destX, destY) region only", async () => {
    const W = 40, H = 10
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: W, height: H })

    const PW = 10, PH = 6
    const srcW = PW * 3, srcH = PH * 3
    const f = new Float32Array(srcW * srcH).fill(1)

    renderer.addPostProcessFn((buf) => {
      buf.clear(RGBA.fromValues(0, 0, 0, 1))
      drawGlyphFit(buf, {
        intensities: f, srcWidth: srcW, srcHeight: srcH,
        x: 5, y: 2, destWidth: PW, destHeight: PH,
        fg: RGBA.fromValues(1, 1, 1, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
        charset: BLOCKS,
      })
    })
    renderer.requestLive()
    await renderOnce()

    const rows = captureCharFrame().split("\n")
    // Region [5..15) × [2..8) should be full blocks. Outside should be spaces.
    expect(rows[0]!.trim()).toBe("")               // above region — blank
    expect(rows[2]![4]).toBe(" ")                  // left of region
    expect(rows[2]![5]).toBe("█")                  // first cell of region
    expect(rows[2]![14]).toBe("█")                 // last column of region
    expect(rows[2]![15]).toBe(" ")                 // right of region
    expect(rows[7]![10]).toBe("█")                 // last row of region
    expect(rows[8]?.[10] ?? " ").toBe(" ")         // below region

    renderer.destroy()
  })

  it("drawGlyphFit and drawGlyphFitColor coexist without buffer corruption", async () => {
    const W = 30, H = 6
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: W, height: H })

    const srcW = 30, srcH = 6
    const intensities = new Float32Array(srcW * srcH).fill(0.7)
    const rgba = new Float32Array(srcW * srcH * 4)
    for (let i = 0; i < srcW * srcH; i++) {
      rgba[i * 4] = 0.5
      rgba[i * 4 + 1] = 0.6
      rgba[i * 4 + 2] = 0.9
      rgba[i * 4 + 3] = 1
    }

    renderer.addPostProcessFn((buf) => {
      buf.clear(RGBA.fromValues(0, 0, 0, 1))
      drawGlyphFit(buf, {
        intensities, srcWidth: srcW, srcHeight: srcH,
        x: 0, y: 0, destWidth: 15, destHeight: 6,
        fg: RGBA.fromValues(1, 1, 1, 1),
        bg: RGBA.fromValues(0, 0, 0, 1),
        charset: BLOCKS_SHADE,
      })
      drawGlyphFitColor(buf, {
        rgba, srcWidth: srcW, srcHeight: srcH,
        x: 15, y: 0, destWidth: 15, destHeight: 6,
        charset: BLOCKS,
      })
    })
    renderer.requestLive()
    await renderOnce()

    const frame = captureCharFrame()
    expect(frame.length).toBeGreaterThan(0)
    // No control characters or replacement sigils should leak.
    expect(frame).not.toContain("\u0000")
    expect(frame).not.toContain("\uFFFD")

    renderer.destroy()
  })
})
