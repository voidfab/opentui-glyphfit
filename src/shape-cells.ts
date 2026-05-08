import type { BufferLike, Charset, ShapeVector } from "./types.ts"
import type { CompiledCharset } from "./compiled-charset.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"

export interface ShapeCellOp {
  x: number
  y: number
  sv: ShapeVector
  fg: import("@opentui/core").RGBA
  bg: import("@opentui/core").RGBA
  cp?: number
  attributes?: number
}

/**
 * Draw cells whose ShapeVectors are already known.
 *
 * This is the direct-shape counterpart to `drawGlyphFit`: callers skip the
 * intensity-field sampling phase and hand glyphfit one ShapeVector per cell.
 * Each op is either matched against `charset`, or drawn directly when `cp`
 * is provided for characters that share the same sample geometry.
 */
export function drawShapeCells(
  target: BufferLike,
  ops: Iterable<ShapeCellOp>,
  charset: Charset,
): void {
  const compiled: CompiledCharset = compileCharset(charset)
  for (const op of ops) {
    let cp: number | undefined = op.cp
    if (cp === undefined) {
      const idx = findBestCharIn(op.sv, compiled)
      cp = compiled.codepoints[idx]
    }
    if (cp === undefined) continue
    target.drawChar(cp, op.x, op.y, op.fg, op.bg, op.attributes)
  }
}
