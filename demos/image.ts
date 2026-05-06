#!/usr/bin/env bun
/**
 * Demo: render any PNG / JPEG image as terminal art.
 *
 * Usage:
 *   bun demos/image.ts <path>                              # default charset
 *   bun demos/image.ts <path>  blocks                      # specific charset
 *   bun demos/image.ts <path>  braille  fire               # charset + palette
 *
 * Charsets:  blocks | braille | box | ascii | shade | blocks_shade  (default: blocks_shade)
 * Palettes:  fire | ocean | synthwave | phosphor | inferno | viridis | grayscale | none
 *            (default: none)
 *
 * Decoding:
 *   PNG  →  pngjs   (pure JS, no native bindings)
 *   JPEG →  jpeg-js (pure JS, no native bindings)
 *
 * Both are devDependencies of this repo. Reach for `sharp` in production code
 * if you want format coverage and speed.
 */

import { createCliRenderer, RGBA, FrameBufferRenderable, CliRenderEvents } from "@opentui/core"
import {
  drawGlyphFit, intensityFromPixels, resampleIntensity,
  BLOCKS, BLOCKS_SHADE, BRAILLE, BOX, ASCII, SHADE,
  paletteFg, FIRE, OCEAN, SYNTHWAVE, PHOSPHOR, INFERNO, VIRIDIS, GRAYSCALE,
  StickyMatcher,
  renderAllFormats, renderToImagePixels,
} from "../src/index.ts"
// @ts-expect-error — pngjs ships no .d.ts via its package.json types field
import { PNG } from "pngjs"
import type { Charset } from "../src/index.ts"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { extname, basename, join } from "node:path"
// @ts-expect-error — pngjs ships no .d.ts via package.json
import { PNG } from "pngjs"
import * as jpeg from "jpeg-js"

const CHARSETS: Record<string, Charset> = {
  blocks: BLOCKS, blocks_shade: BLOCKS_SHADE, braille: BRAILLE,
  box: BOX, ascii: ASCII, shade: SHADE,
}

const PALETTES: Record<string, RGBA[]> = {
  fire: FIRE, ocean: OCEAN, synthwave: SYNTHWAVE, phosphor: PHOSPHOR,
  inferno: INFERNO, viridis: VIRIDIS, grayscale: GRAYSCALE,
}

interface Decoded { rgba: Uint8Array; width: number; height: number }

function decodeImage(path: string): Decoded {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`); process.exit(1)
  }
  const bytes = readFileSync(path)
  const ext = extname(path).toLowerCase()

  if (ext === ".png") {
    const png = PNG.sync.read(bytes)
    return { rgba: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength),
             width: png.width, height: png.height }
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
    return { rgba: img.data as Uint8Array, width: img.width, height: img.height }
  }
  console.error(`Unsupported image format: ${ext}`)
  console.error(`This demo decodes PNG and JPEG only. For other formats, use a different`)
  console.error(`decoder (sharp, jimp) and feed the resulting pixel buffer through`)
  console.error(`intensityFromPixels() directly. See README.`)
  process.exit(1)
}

interface Opts {
  charsetName: string
  charset: Charset
  paletteName: string
  palette: RGBA[] | null
}

function parseArgs(): { path: string; opts: Opts } {
  const [path, charsetName = "blocks_shade", paletteName = "none"] = process.argv.slice(2)
  if (!path) {
    console.error(`
Usage: bun demos/image.ts <image-path> [charset] [palette]

  charsets: ${Object.keys(CHARSETS).join(", ")}
  palettes: none, ${Object.keys(PALETTES).join(", ")}

Examples:
  bun demos/image.ts photo.jpg
  bun demos/image.ts photo.jpg  blocks_shade
  bun demos/image.ts photo.jpg  braille      fire
  bun demos/image.ts photo.jpg  box          viridis

Press [c] to cycle charset, [p] to cycle palette, [q] to quit.
`)
    process.exit(1)
  }
  const charset = CHARSETS[charsetName]
  if (!charset) {
    console.error(`Unknown charset '${charsetName}'. Try one of: ${Object.keys(CHARSETS).join(", ")}`)
    process.exit(1)
  }
  const palette = paletteName === "none" ? null : PALETTES[paletteName]
  if (paletteName !== "none" && !palette) {
    console.error(`Unknown palette '${paletteName}'. Try: none, ${Object.keys(PALETTES).join(", ")}`)
    process.exit(1)
  }
  return { path, opts: { charsetName, charset, paletteName, palette: palette ?? null } }
}

async function main() {
  const { path, opts } = parseArgs()

  process.stderr.write(`Decoding ${path}...\n`)
  const { rgba, width: imgW, height: imgH } = decodeImage(path)
  process.stderr.write(`Image: ${imgW}\u00d7${imgH} (${(rgba.length / 1024).toFixed(0)} KB raw)\n`)

  const fullField = intensityFromPixels(rgba, imgW, imgH, { luminance: "rec709" })

  const renderer = await createCliRenderer({ targetFps: 30, exitOnCtrlC: true })
  const FG = RGBA.fromValues(0.85, 0.95, 1.0, 1)
  const BG = RGBA.fromValues(0, 0, 0, 1)

  let fb: FrameBufferRenderable | null = null
  function ensureFB(W: number, H: number) {
    if (!fb) {
      fb = new FrameBufferRenderable(renderer, { id: "img", width: W, height: H, zIndex: 0 })
      renderer.root.add(fb)
    } else { fb.frameBuffer.resize(W, H) }
  }
  ensureFB(renderer.terminalWidth, renderer.terminalHeight)
  renderer.on(CliRenderEvents.RESIZE, () => ensureFB(renderer.terminalWidth, renderer.terminalHeight))

  // Mutable state — driven by [c] / [p] keys.
  const state = {
    charsetIdx: Object.keys(CHARSETS).indexOf(opts.charsetName),
    paletteIdx: opts.paletteName === "none" ? -1 : Object.keys(PALETTES).indexOf(opts.paletteName),
  }
  const csKeys = Object.keys(CHARSETS)
  const palKeys = ["none", ...Object.keys(PALETTES)]

  const sticky = new StickyMatcher({ tolerance: 0.04 })

  // Transient toast (shown in the title bar for ~3 s after a screenshot save).
  let toast: { msg: string; until: number } | null = null

  // Mirror the inputs we feed into drawGlyphFit so the [s] handler can
  // re-render the same frame to text / ANSI / HTML.
  let lastRender: {
    intensities: Float32Array
    srcWidth: number; srcHeight: number
    destWidth: number; destHeight: number
    charset: Charset
    intensityToFg?: (avg: number, fg: RGBA) => RGBA
    csName: string; palName: string
  } | null = null

  const SCREENSHOT_DIR = process.env.GLYPHFIT_SCREENSHOT_DIR ?? "screenshots"

  function saveScreenshot(): void {
    if (!lastRender) {
      toast = { msg: "\u26a0  nothing to capture yet", until: Date.now() + 2000 }
      return
    }
    try {
      mkdirSync(SCREENSHOT_DIR, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
      const stem = basename(path).replace(/\.[^.]+$/, "")
      const tag = `${lastRender.csName}${lastRender.palName !== "none" ? "-" + lastRender.palName : ""}`
      const base = `${stem}_${tag}_${stamp}`

      const out = renderAllFormats({
        intensities: lastRender.intensities,
        srcWidth: lastRender.srcWidth, srcHeight: lastRender.srcHeight,
        destWidth: lastRender.destWidth, destHeight: lastRender.destHeight,
        fg: FG, bg: BG, charset: lastRender.charset,
        ...(lastRender.intensityToFg && { intensityToFg: lastRender.intensityToFg }),
      }, { title: `glyphfit \u2014 ${stem} \u2014 ${tag}` })

      writeFileSync(join(SCREENSHOT_DIR, base + ".txt"),      out.txt)
      writeFileSync(join(SCREENSHOT_DIR, base + ".ansi.txt"), out.ansi)
      writeFileSync(join(SCREENSHOT_DIR, base + ".html"),     out.html)

      // PNG (wallpaper).
      //
      //   GLYPHFIT_PNG_LONG_EDGE  pixels  (default 2560)         long-edge target
      //   GLYPHFIT_PNG_CELLS_WIDE cells   (default = on-screen)  re-render at higher
      //                                                          cell density for more detail
      const TARGET_LONG  = parseInt(process.env.GLYPHFIT_PNG_LONG_EDGE  ?? "2560", 10)
      const cellsWideEnv = parseInt(process.env.GLYPHFIT_PNG_CELLS_WIDE ?? "", 10)
      const useDenseRender = Number.isFinite(cellsWideEnv) && cellsWideEnv > lastRender.destWidth

      // Aspect-preserving cell count: keep the same cell aspect ratio as on-screen.
      const aspectCells = lastRender.destHeight / lastRender.destWidth
      const denseW = useDenseRender ? cellsWideEnv : lastRender.destWidth
      const denseH = useDenseRender ? Math.max(1, Math.round(cellsWideEnv * aspectCells)) : lastRender.destHeight
      const denseSrcW = denseW * 2, denseSrcH = denseH * 4
      const denseField = useDenseRender
        ? resampleIntensity(fullField, imgW, imgH, denseSrcW, denseSrcH)
        : lastRender.intensities
      const denseSrcWUsed = useDenseRender ? denseSrcW : lastRender.srcWidth
      const denseSrcHUsed = useDenseRender ? denseSrcH : lastRender.srcHeight

      const cw = Math.max(2, Math.floor(TARGET_LONG / denseW))
      const ch = cw * 2
      const img = renderToImagePixels({
        intensities: denseField,
        srcWidth: denseSrcWUsed, srcHeight: denseSrcHUsed,
        destWidth: denseW, destHeight: denseH,
        fg: FG, bg: BG, charset: lastRender.charset,
        ...(lastRender.intensityToFg && { intensityToFg: lastRender.intensityToFg }),
        cellWidth: cw, cellHeight: ch,
      })
      const png = new PNG({ width: img.width, height: img.height })
      png.data = Buffer.from(img.rgba)
      const pngBuf: Buffer = PNG.sync.write(png)
      writeFileSync(join(SCREENSHOT_DIR, base + ".png"), pngBuf)

      toast = {
        msg: `\u2713 saved \u2192 ${SCREENSHOT_DIR}/${base}.{txt,ansi.txt,html,png}  (${img.width}\u00d7${img.height})`,
        until: Date.now() + 4500,
      }
    } catch (e) {
      toast = { msg: `\u2717  ${(e as Error).message}`, until: Date.now() + 4000 }
    }
  }

  process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.setEncoding("utf8")
  process.stdin.on("data", (k: string) => {
    switch (k) {
      case "q": case "\x03":
        cleanup(); process.exit(0); break
      case "c":
        state.charsetIdx = (state.charsetIdx + 1) % csKeys.length
        sticky.reset(); break
      case "p":
        state.paletteIdx = (state.paletteIdx + 2) % (palKeys.length) - 1
        break
      case "s":
        saveScreenshot(); break
    }
  })
  const cleanup = () => {
    try { process.stdin.setRawMode?.(false); process.stdin.pause() } catch {}
    try { renderer.destroy() } catch {}
  }
  process.on("exit", cleanup)
  process.on("SIGINT",  () => { cleanup(); process.exit(130) })
  process.on("SIGTERM", () => { cleanup(); process.exit(143) })
  process.on("uncaughtException", (e) => { cleanup(); console.error(e); process.exit(1) })

  let cachedField: Float32Array | null = null
  let cachedW = 0, cachedH = 0

  renderer.setFrameCallback(async () => {
    if (!fb) return
    const buf = fb.frameBuffer
    const W = buf.width, H = buf.height
    if (W < 8 || H < 4) return

    const destW = W
    const destH = H - 1
    // 2× horizontal × 4× vertical supersample compensates for the 2:1 cell aspect
    // and gives the 6-point sampler a healthy sub-cell signal.
    const srcW = destW * 2
    const srcH = destH * 4

    if (!cachedField || cachedW !== srcW || cachedH !== srcH) {
      cachedField = resampleIntensity(fullField, imgW, imgH, srcW, srcH)
      cachedW = srcW; cachedH = srcH
      sticky.reset()
    }
    sticky.resize(destW, destH)

    buf.clear(BG)

    const csName = csKeys[state.charsetIdx]!
    const palName = palKeys[state.paletteIdx + 1]!
    const charset = CHARSETS[csName]!
    const palette = palName === "none" ? null : PALETTES[palName]!
    const intensityToFg = palette ? paletteFg(palette) : undefined

    const showToast = toast !== null && Date.now() < toast.until
    const titleBg = showToast ? RGBA.fromValues(0, 0.25, 0.05, 1) : RGBA.fromValues(0, 0, 0.18, 1)
    const titleFg = RGBA.fromValues(1, 1, 1, 1)
    const title = showToast
      ? ` ${toast!.msg}`
      : ` opentui-glyphfit  \u00b7  ${path}  \u00b7  charset:${csName}  \u00b7  palette:${palName}  \u00b7  [c]charset [p]palette [s]save [q]quit`
    buf.drawText(title.padEnd(W).slice(0, W), 0, 0, titleFg, titleBg)

    drawGlyphFit(buf, {
      intensities: cachedField, srcWidth: srcW, srcHeight: srcH,
      x: 0, y: 1, destWidth: destW, destHeight: destH,
      fg: FG, bg: BG, charset, sticky,
      ...(intensityToFg && { intensityToFg }),
    })

    // Cache the inputs so the [s] handler can re-render to text/HTML/ANSI.
    lastRender = {
      intensities: cachedField, srcWidth: srcW, srcHeight: srcH,
      destWidth: destW, destHeight: destH,
      charset,
      ...(intensityToFg && { intensityToFg }),
      csName, palName,
    }
  })

  renderer.start()
}

main().catch(err => { console.error(err); process.exit(1) })
