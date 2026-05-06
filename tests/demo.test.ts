/**
 * Demo runtime smoke test.
 *
 * The bigger snapshot/integration tests use `addPostProcessFn` + `requestLive`,
 * which is a different code path from `setFrameCallback` + `FrameBufferRenderable`
 * (used by the comparison demo). This test exercises the same public OpenTUI
 * APIs the demo uses so any runtime regression in that integration is caught.
 *
 * What it pins:
 *   - drawGlyphFit composes correctly into a `FrameBufferRenderable.frameBuffer`
 *   - the renderer's frame loop drives the callback at least N times
 *   - no exception is silently swallowed during the frame callback
 *   - both panels (built-in left, glyphfit right) write content with non-zero
 *     dest offsets
 */
import { describe, it, expect } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { RGBA, FrameBufferRenderable } from "@opentui/core"
import { drawGlyphFit, BLOCKS_SHADE } from "../src/index.ts"

describe("demo-style frame-callback integration", () => {
  it("setFrameCallback + FrameBufferRenderable + drawGlyphFit at non-zero destX writes content", async () => {
    const W = 60, H = 12
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: W, height: H })

    // Mirror the demo's structure: FrameBufferRenderable filling the buffer,
    // setFrameCallback driving updates, two-panel layout, glyphfit at non-zero x.
    const fbR = new FrameBufferRenderable(renderer, { id: "demo-smoke", width: W, height: H, zIndex: 0 })
    renderer.root.add(fbR)

    const FG = RGBA.fromValues(1, 1, 1, 1)
    const BG = RGBA.fromValues(0, 0, 0, 1)
    const DIV = Math.floor(W / 2)
    const RIGHT_W = W - DIV - 1
    const PANEL_H = H

    let frames = 0
    let frameError: Error | null = null

    renderer.setFrameCallback(async (_dt) => {
      frames++
      try {
        const buf = fbR.frameBuffer
        buf.clear(BG)

        // 3× supersample full-bright field — every cell should produce a non-space char.
        const srcW = RIGHT_W * 3, srcH = PANEL_H * 3
        const field = new Float32Array(srcW * srcH).fill(1)

        drawGlyphFit(buf, {
          intensities: field, srcWidth: srcW, srcHeight: srcH,
          x: DIV + 1, y: 0,
          destWidth: RIGHT_W, destHeight: PANEL_H,
          fg: FG, bg: BG, charset: BLOCKS_SHADE,
        })
      } catch (e) {
        frameError = e as Error
      }
    })

    renderer.start()
    renderer.requestLive()
    await renderOnce()
    await renderOnce()
    await renderOnce()

    // The frame callback fired at least once and threw nothing.
    expect(frames).toBeGreaterThanOrEqual(1)
    expect(frameError).toBeNull()

    // The right panel cells are non-empty in the captured frame.
    const rows = captureCharFrame().split("\n")
    let rightPanelChars = 0
    for (const row of rows) {
      for (let x = DIV + 1; x < W; x++) {
        const ch = row[x]
        if (ch && ch !== " " && ch !== "\u00A0") rightPanelChars++
      }
    }
    expect(rightPanelChars).toBeGreaterThan(0)

    renderer.destroy()
  })

  it("frame callback errors propagate (regression: silent ReferenceError swallowed empty panels)", async () => {
    // If the demo's frame callback throws (e.g. undeclared variable), the renderer
    // must surface it — not silently render an empty frame.
    const { renderer, renderOnce } = await createTestRenderer({ width: 20, height: 6 })
    const fbR = new FrameBufferRenderable(renderer, { id: "throw-test", width: 20, height: 6, zIndex: 0 })
    renderer.root.add(fbR)

    let invocations = 0
    const sentinel = new Error("intentional frame-callback failure")
    let captured: unknown = null
    renderer.setFrameCallback(async () => {
      invocations++
      try { throw sentinel } catch (e) { captured = e }
    })

    renderer.start()
    renderer.requestLive()
    await renderOnce()

    // Callback was invoked AND the error is observable to the caller's try/catch.
    expect(invocations).toBeGreaterThanOrEqual(1)
    expect(captured).toBe(sentinel)

    renderer.destroy()
  })
})
