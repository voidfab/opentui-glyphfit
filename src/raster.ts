/**
 * Pixel rasterization for charset glyphs.
 *
 * Block / half / quadrant / eighth / shade / braille / box characters all
 * have analytic geometric definitions, so they rasterize crisply at any cell
 * size without a font dependency. ASCII characters fall back to a directional
 * 2\u00d73 fill of their ShapeVector \u2014 imperfect but coherent and font-free.
 *
 * All raster routines write into a caller-provided RGBA byte buffer
 * (`Uint8Array` of length `imageWidth * imageHeight * 4`, row-major).
 */

import { shapeOf } from "./index.ts"

/** Concrete RGBA in 0..255 ints. */
type RGB255 = readonly [number, number, number, number]

/* ────────── Pixel helpers ────────── */

function setPixel(
  out: Uint8Array,
  imgW: number,
  x: number, y: number,
  r: number, g: number, b: number, a: number,
): void {
  const i = (y * imgW + x) * 4
  out[i]     = r
  out[i + 1] = g
  out[i + 2] = b
  out[i + 3] = a
}

function fillRect(
  out: Uint8Array, imgW: number,
  x0: number, y0: number, x1: number, y1: number,
  fg: RGB255,
): void {
  const [r, g, b, a] = fg
  for (let y = y0; y < y1; y++) {
    let off = (y * imgW + x0) * 4
    for (let x = x0; x < x1; x++) {
      out[off]     = r
      out[off + 1] = g
      out[off + 2] = b
      out[off + 3] = a
      off += 4
    }
  }
}

function blendRect(
  out: Uint8Array, imgW: number,
  x0: number, y0: number, x1: number, y1: number,
  fg: RGB255, bg: RGB255, t: number,
): void {
  const inv = 1 - t
  const r = Math.round(bg[0] * inv + fg[0] * t)
  const g = Math.round(bg[1] * inv + fg[1] * t)
  const b = Math.round(bg[2] * inv + fg[2] * t)
  const a = Math.round(bg[3] * inv + fg[3] * t)
  fillRect(out, imgW, x0, y0, x1, y1, [r, g, b, a])
}

function fillFilledCircle(
  out: Uint8Array, imgW: number, imgH: number,
  cx: number, cy: number, radius: number,
  fg: RGB255,
): void {
  const r2 = radius * radius
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(imgW, Math.ceil(cx + radius + 1))
  const y1 = Math.min(imgH, Math.ceil(cy + radius + 1))
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx
      if (dx * dx + dy * dy <= r2) setPixel(out, imgW, x, y, fg[0], fg[1], fg[2], fg[3])
    }
  }
}

/* ────────── Char-class rasterizers ────────── */

interface CellRaster {
  out: Uint8Array
  imgW: number
  imgH: number
  /** Cell origin in pixels. */
  ox: number
  oy: number
  /** Cell size in pixels. */
  cw: number
  ch: number
  fg: RGB255
  bg: RGB255
}

/* Half- and full-block: U+2580 \u2580, U+2584 \u2584, U+258C \u258C, U+2590 \u2590, U+2588 \u2588 */
function rasterHalfBlock(c: CellRaster, cp: number): boolean {
  const { out, imgW, ox, oy, cw, ch, fg } = c
  const xMid = ox + Math.round(cw / 2)
  const yMid = oy + Math.round(ch / 2)
  switch (cp) {
    case 0x2588: fillRect(out, imgW, ox, oy, ox + cw, oy + ch, fg);     return true
    case 0x2580: fillRect(out, imgW, ox, oy, ox + cw, yMid,    fg);     return true
    case 0x2584: fillRect(out, imgW, ox, yMid, ox + cw, oy + ch, fg);   return true
    case 0x258C: fillRect(out, imgW, ox, oy, xMid, oy + ch,    fg);     return true
    case 0x2590: fillRect(out, imgW, xMid, oy, ox + cw, oy + ch, fg);   return true
  }
  return false
}

/* Lower 1/8 .. 7/8 blocks: U+2581 .. U+2587 */
function rasterEighth(c: CellRaster, cp: number): boolean {
  if (cp < 0x2581 || cp > 0x2587) return false
  const n = cp - 0x2580                         // 1..7
  const yTop = c.oy + Math.round(c.ch * (1 - n / 8))
  fillRect(c.out, c.imgW, c.ox, yTop, c.ox + c.cw, c.oy + c.ch, c.fg)
  return true
}

/* Quadrants: U+2596 \u2596, U+2597 \u2597, U+2598 \u2598, U+2599 \u2599, U+259A \u259A, U+259B \u259B, U+259C \u259C, U+259D \u259D, U+259E \u259E, U+259F \u259F */
function rasterQuadrant(c: CellRaster, cp: number): boolean {
  // Bits: TL TR BL BR
  const map: Record<number, number> = {
    0x2596: 0b0010, 0x2597: 0b0001,                  // \u2596 \u2597
    0x2598: 0b1000, 0x259D: 0b0100,                  // \u2598 \u259D
    0x259A: 0b1001, 0x259E: 0b0110,                  // \u259A \u259E
    0x2599: 0b1011, 0x259B: 0b1110,                  // \u2599 \u259B
    0x259C: 0b1101, 0x259F: 0b0111,                  // \u259C \u259F
  }
  const bits = map[cp]
  if (bits === undefined) return false
  const { out, imgW, ox, oy, cw, ch, fg } = c
  const xMid = ox + Math.round(cw / 2)
  const yMid = oy + Math.round(ch / 2)
  if (bits & 0b1000) fillRect(out, imgW, ox,   oy,   xMid, yMid,     fg)  // TL
  if (bits & 0b0100) fillRect(out, imgW, xMid, oy,   ox + cw, yMid,  fg)  // TR
  if (bits & 0b0010) fillRect(out, imgW, ox,   yMid, xMid, oy + ch,  fg)  // BL
  if (bits & 0b0001) fillRect(out, imgW, xMid, yMid, ox + cw, oy + ch, fg) // BR
  return true
}

/* Shade chars: U+2591 (25%), U+2592 (50%), U+2593 (75%) */
function rasterShade(c: CellRaster, cp: number): boolean {
  let t: number
  switch (cp) {
    case 0x2591: t = 0.25; break
    case 0x2592: t = 0.50; break
    case 0x2593: t = 0.75; break
    default: return false
  }
  blendRect(c.out, c.imgW, c.ox, c.oy, c.ox + c.cw, c.oy + c.ch, c.fg, c.bg, t)
  return true
}

/* Braille U+2800..U+28FF */
function rasterBraille(c: CellRaster, cp: number): boolean {
  if (cp < 0x2800 || cp > 0x28FF) return false
  const bits = cp - 0x2800
  const { out, imgW, imgH, ox, oy, cw, ch, fg } = c
  const xL = ox + cw * 0.30
  const xR = ox + cw * 0.70
  // 4 vertical dot rows in approximately 1/8, 3/8, 5/8, 7/8
  const rowYs = [oy + ch * 0.18, oy + ch * 0.40, oy + ch * 0.62, oy + ch * 0.84]
  const radius = Math.max(1, Math.min(cw, ch) * 0.12)

  // Bit layout: 1=d1 TL, 2=d2 ML-up, 4=d3 ML-lo, 8=d4 TR, 0x10=d5 MR-up, 0x20=d6 MR-lo, 0x40=d7 BL, 0x80=d8 BR
  if (bits & 0x01) fillFilledCircle(out, imgW, imgH, xL, rowYs[0]!, radius, fg)
  if (bits & 0x02) fillFilledCircle(out, imgW, imgH, xL, rowYs[1]!, radius, fg)
  if (bits & 0x04) fillFilledCircle(out, imgW, imgH, xL, rowYs[2]!, radius, fg)
  if (bits & 0x40) fillFilledCircle(out, imgW, imgH, xL, rowYs[3]!, radius, fg)
  if (bits & 0x08) fillFilledCircle(out, imgW, imgH, xR, rowYs[0]!, radius, fg)
  if (bits & 0x10) fillFilledCircle(out, imgW, imgH, xR, rowYs[1]!, radius, fg)
  if (bits & 0x20) fillFilledCircle(out, imgW, imgH, xR, rowYs[2]!, radius, fg)
  if (bits & 0x80) fillFilledCircle(out, imgW, imgH, xR, rowYs[3]!, radius, fg)
  return true
}

/* Box drawing — primitive lines and corners */
function rasterBox(c: CellRaster, cp: number): boolean {
  const { out, imgW, ox, oy, cw, ch, fg } = c
  const xMid = ox + Math.round(cw / 2)
  const yMid = oy + Math.round(ch / 2)
  // Stroke widths scale with cell size, minimum 1 px.
  const sH = Math.max(1, Math.round(ch * 0.12))    // horizontal line height
  const sV = Math.max(1, Math.round(cw * 0.12))    // vertical line width
  const hY0 = yMid - Math.floor(sH / 2)
  const hY1 = hY0 + sH
  const vX0 = xMid - Math.floor(sV / 2)
  const vX1 = vX0 + sV

  // Heavy strokes
  const sHeavy = Math.max(2, Math.round(Math.max(cw, ch) * 0.18))
  // Doubles get a 2-line treatment with a gap
  const dGap = Math.max(1, Math.round(Math.min(cw, ch) * 0.08))

  switch (cp) {
    /* Light horizontal / vertical */
    case 0x2500: fillRect(out, imgW, ox, hY0, ox + cw, hY1, fg); return true
    case 0x2502: fillRect(out, imgW, vX0, oy, vX1, oy + ch, fg); return true
    /* Heavy */
    case 0x2501:
      fillRect(out, imgW, ox, yMid - Math.floor(sHeavy / 2), ox + cw, yMid - Math.floor(sHeavy / 2) + sHeavy, fg)
      return true
    case 0x2503:
      fillRect(out, imgW, xMid - Math.floor(sHeavy / 2), oy, xMid - Math.floor(sHeavy / 2) + sHeavy, oy + ch, fg)
      return true
    /* Double */
    case 0x2550:
      fillRect(out, imgW, ox, hY0 - dGap, ox + cw, hY0 - dGap + sH, fg)
      fillRect(out, imgW, ox, hY1 + dGap, ox + cw, hY1 + dGap + sH, fg)
      return true
    case 0x2551:
      fillRect(out, imgW, vX0 - dGap, oy, vX0 - dGap + sV, oy + ch, fg)
      fillRect(out, imgW, vX1 + dGap, oy, vX1 + dGap + sV, oy + ch, fg)
      return true

    /* Corners */
    case 0x250C: // \u250C
      fillRect(out, imgW, xMid, hY0, ox + cw, hY1, fg)
      fillRect(out, imgW, vX0, yMid, vX1, oy + ch, fg)
      return true
    case 0x2510: // \u2510
      fillRect(out, imgW, ox, hY0, xMid + sV, hY1, fg)
      fillRect(out, imgW, vX0, yMid, vX1, oy + ch, fg)
      return true
    case 0x2514: // \u2514
      fillRect(out, imgW, xMid, hY0, ox + cw, hY1, fg)
      fillRect(out, imgW, vX0, oy, vX1, yMid + sH, fg)
      return true
    case 0x2518: // \u2518
      fillRect(out, imgW, ox, hY0, xMid + sV, hY1, fg)
      fillRect(out, imgW, vX0, oy, vX1, yMid + sH, fg)
      return true

    /* T-junctions */
    case 0x251C: // \u251C
      fillRect(out, imgW, vX0, oy, vX1, oy + ch, fg)
      fillRect(out, imgW, xMid, hY0, ox + cw, hY1, fg)
      return true
    case 0x2524: // \u2524
      fillRect(out, imgW, vX0, oy, vX1, oy + ch, fg)
      fillRect(out, imgW, ox, hY0, xMid + sV, hY1, fg)
      return true
    case 0x252C: // \u252C
      fillRect(out, imgW, ox, hY0, ox + cw, hY1, fg)
      fillRect(out, imgW, vX0, yMid, vX1, oy + ch, fg)
      return true
    case 0x2534: // \u2534
      fillRect(out, imgW, ox, hY0, ox + cw, hY1, fg)
      fillRect(out, imgW, vX0, oy, vX1, yMid + sH, fg)
      return true
    case 0x253C: // \u253C
      fillRect(out, imgW, ox, hY0, ox + cw, hY1, fg)
      fillRect(out, imgW, vX0, oy, vX1, oy + ch, fg)
      return true

    /* Dashed light */
    case 0x2504:
      for (let k = 0; k < 3; k++) {
        const x0 = ox + Math.round(cw * (k / 3 + 0.05))
        const x1 = ox + Math.round(cw * ((k + 1) / 3 - 0.05))
        fillRect(out, imgW, x0, hY0, x1, hY1, fg)
      }
      return true
    case 0x2506:
      for (let k = 0; k < 3; k++) {
        const y0 = oy + Math.round(ch * (k / 3 + 0.05))
        const y1 = oy + Math.round(ch * ((k + 1) / 3 - 0.05))
        fillRect(out, imgW, vX0, y0, vX1, y1, fg)
      }
      return true
    case 0x2508:
      for (let k = 0; k < 4; k++) {
        const x0 = ox + Math.round(cw * (k / 4 + 0.05))
        const x1 = ox + Math.round(cw * ((k + 1) / 4 - 0.05))
        fillRect(out, imgW, x0, hY0, x1, hY1, fg)
      }
      return true
    case 0x250A:
      for (let k = 0; k < 4; k++) {
        const y0 = oy + Math.round(ch * (k / 4 + 0.05))
        const y1 = oy + Math.round(ch * ((k + 1) / 4 - 0.05))
        fillRect(out, imgW, vX0, y0, vX1, y1, fg)
      }
      return true

    /* Diagonals (Bresenham) */
    case 0x2571: drawLine(out, imgW, ox + cw - 1, oy, ox, oy + ch - 1, fg, sV); return true  // /
    case 0x2572: drawLine(out, imgW, ox, oy, ox + cw - 1, oy + ch - 1, fg, sV); return true  // \
    case 0x2573: // X
      drawLine(out, imgW, ox + cw - 1, oy, ox, oy + ch - 1, fg, sV)
      drawLine(out, imgW, ox, oy, ox + cw - 1, oy + ch - 1, fg, sV)
      return true
  }
  return false
}

/* Bresenham-ish line with thickness */
function drawLine(
  out: Uint8Array, imgW: number,
  x0: number, y0: number, x1: number, y1: number,
  fg: RGB255, thickness: number,
): void {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  let x = x0, y = y0
  const half = Math.max(0, Math.floor(thickness / 2))

  for (;;) {
    for (let dyT = -half; dyT <= half; dyT++) {
      for (let dxT = -half; dxT <= half; dxT++) {
        const xx = x + dxT, yy = y + dyT
        if (xx >= 0 && yy >= 0) setPixel(out, imgW, xx, yy, fg[0], fg[1], fg[2], fg[3])
      }
    }
    if (x === x1 && y === y1) break
    const e2 = err * 2
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 <  dx) { err += dx; y += sy }
  }
}

/* ASCII / unknown — degraded ShapeVector fill (2 cols \u00d7 3 rows of intensity-tinted rects) */
function rasterShapeVectorFallback(c: CellRaster, cp: number): boolean {
  const sv = shapeOf(cp)
  if (!sv) return false
  const { out, imgW, ox, oy, cw, ch, fg, bg } = c
  const xMid = ox + Math.round(cw / 2)
  const yT   = oy + Math.round(ch / 3)
  const yB   = oy + Math.round((2 * ch) / 3)
  blendRect(out, imgW, ox,   oy,  xMid,    yT,        fg, bg, sv[0])
  blendRect(out, imgW, xMid, oy,  ox + cw, yT,        fg, bg, sv[1])
  blendRect(out, imgW, ox,   yT,  xMid,    yB,        fg, bg, sv[2])
  blendRect(out, imgW, xMid, yT,  ox + cw, yB,        fg, bg, sv[3])
  blendRect(out, imgW, ox,   yB,  xMid,    oy + ch,   fg, bg, sv[4])
  blendRect(out, imgW, xMid, yB,  ox + cw, oy + ch,   fg, bg, sv[5])
  return true
}

/* ────────── Public entry ────────── */

/**
 * Rasterize one cell into `out` at `(ox, oy)`. Returns `true` if the codepoint
 * was recognised and drawn (or filled, in the case of space — no-op),
 * `false` if no analytical or fallback definition exists.
 */
export function rasterizeCell(
  out: Uint8Array,
  imgW: number, imgH: number,
  ox: number, oy: number,
  cw: number, ch: number,
  codepoint: number,
  fg: RGB255, bg: RGB255,
): boolean {
  // Background is already painted by the caller; space + below-threshold cells
  // are no-ops.
  if (codepoint === 0x20) return true

  const c: CellRaster = { out, imgW, imgH, ox, oy, cw, ch, fg, bg }

  if (rasterHalfBlock(c, codepoint))   return true
  if (rasterEighth(c, codepoint))      return true
  if (rasterQuadrant(c, codepoint))    return true
  if (rasterShade(c, codepoint))       return true
  if (rasterBraille(c, codepoint))     return true
  if (rasterBox(c, codepoint))         return true
  if (rasterShapeVectorFallback(c, codepoint)) return true

  return false
}
