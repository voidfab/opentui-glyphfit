/**
 * Image-to-intensity conversion.
 *
 * This module deliberately does NOT bundle an image decoder — instead it
 * takes already-decoded pixel data and produces a Float32Array intensity
 * field suitable for `drawGlyphFit`.
 *
 * Bring your own decoder. Examples:
 *
 * ```ts
 * // Sharp (Node):
 * import sharp from "sharp"
 * const { data, info } = await sharp("photo.jpg").raw().ensureAlpha().toBuffer({ resolveWithObject: true })
 * const field = intensityFromPixels(data, info.width, info.height)
 *
 * // Jimp:
 * import { Jimp } from "jimp"
 * const img = await Jimp.read("photo.jpg")
 * const field = intensityFromPixels(img.bitmap.data, img.bitmap.width, img.bitmap.height)
 *
 * // HTML Canvas (browser):
 * const imgData = ctx.getImageData(0, 0, w, h)
 * const field = intensityFromPixels(imgData.data, imgData.width, imgData.height)
 * ```
 */

import { InvalidFieldError } from "./errors.ts"

/** Luminance formula used to convert RGB → single-channel intensity. */
export type LuminanceFormula =
  /** Rec.709 (sRGB) — perceptually accurate for modern displays. (default) */
  | "rec709"
  /** Rec.601 (NTSC) — slightly darker greens, classic. */
  | "rec601"
  /** Plain `(r + g + b) / 3`. Wrong perceptually but matches some old tools. */
  | "average"
  /** `max(r, g, b)`. Brightens saturated colours. */
  | "max"
  /** Use the alpha channel as intensity directly. Useful for masks/icons. */
  | "alpha"

export interface IntensityFromPixelsOptions {
  /** Luminance formula. Default `"rec709"`. */
  luminance?: LuminanceFormula
  /** If true, treat input bytes as `[0,255]` and divide. Default `true`. */
  byteScale?: boolean
  /** Invert the result (1 - x). Default `false`. */
  invert?: boolean
  /** Pre-multiply by alpha. Default `false` (most callers want raw intensity). */
  premultiplyAlpha?: boolean
  /** Optional gamma applied AFTER intensity extraction. Default `1` (no-op). */
  gamma?: number
  /** Number of bytes per pixel. Default `4` (RGBA). Pass `3` for RGB or `1` for greyscale. */
  channels?: 1 | 3 | 4
}

/**
 * Convert decoded pixel data into a `Float32Array` intensity field.
 *
 * Input layout assumed to be row-major, with `channels` bytes per pixel.
 * For RGBA (4-channel) input, channel order is R, G, B, A.
 *
 * Output values are in `[0, 1]`.
 *
 * @param pixels   - `Uint8Array | Uint8ClampedArray | ArrayLike<number>`
 * @param width    - image width in pixels
 * @param height   - image height in pixels
 * @param options  - extraction options (see `IntensityFromPixelsOptions`)
 */
export function intensityFromPixels(
  pixels: Uint8Array | Uint8ClampedArray | ArrayLike<number>,
  width: number,
  height: number,
  options: IntensityFromPixelsOptions = {},
): Float32Array {
  const luminance = options.luminance ?? "rec709"
  const byteScale = options.byteScale ?? true
  const invert    = options.invert    ?? false
  const premul    = options.premultiplyAlpha ?? false
  const gamma     = options.gamma     ?? 1
  const channels  = options.channels  ?? 4

  if (!Number.isInteger(width)  || width  <= 0) throw new InvalidFieldError(`width must be > 0, got ${width}`)
  if (!Number.isInteger(height) || height <= 0) throw new InvalidFieldError(`height must be > 0, got ${height}`)
  const expected = width * height * channels
  if (pixels.length !== expected) {
    throw new InvalidFieldError(`pixels.length (${pixels.length}) !== width*height*channels (${expected})`)
  }
  if (gamma <= 0 || !Number.isFinite(gamma)) {
    throw new InvalidFieldError(`gamma must be a positive finite number, got ${gamma}`)
  }

  const out = new Float32Array(width * height)
  const inv255 = byteScale ? 1 / 255 : 1
  const useGamma = gamma !== 1

  for (let i = 0, o = 0; o < out.length; o++, i += channels) {
    let v: number
    if (channels === 1) {
      v = (pixels[i] ?? 0) * inv255
    } else {
      const r = (pixels[i] ?? 0) * inv255
      const g = (pixels[i + 1] ?? 0) * inv255
      const b = (pixels[i + 2] ?? 0) * inv255
      const a = channels === 4 ? (pixels[i + 3] ?? 0) * inv255 : 1

      switch (luminance) {
        case "rec709":  v = 0.2126 * r + 0.7152 * g + 0.0722 * b; break
        case "rec601":  v = 0.299  * r + 0.587  * g + 0.114  * b; break
        case "average": v = (r + g + b) / 3;                        break
        case "max":     v = r > g ? (r > b ? r : b) : (g > b ? g : b); break
        case "alpha":   v = a;                                      break
      }
      if (premul && channels === 4) v *= a
    }

    if (invert)   v = 1 - v
    if (useGamma) v = Math.pow(v < 0 ? 0 : v, gamma)
    if (v < 0) v = 0
    else if (v > 1) v = 1
    out[o] = v
  }

  return out
}

/**
 * Resample an intensity field to new dimensions using bilinear interpolation.
 * Useful when you've decoded a 1024×1024 image but want it at 200×80 cells:
 *
 * ```ts
 * const big = intensityFromPixels(decoded, 1024, 1024)
 * const small = resampleIntensity(big, 1024, 1024, 600, 240)  // 3× supersample of 200×80 cells
 * ```
 */
export function resampleIntensity(
  src: Float32Array,
  srcWidth: number, srcHeight: number,
  dstWidth: number, dstHeight: number,
): Float32Array {
  if (!Number.isInteger(srcWidth)  || srcWidth  <= 0) throw new InvalidFieldError(`srcWidth must be > 0`)
  if (!Number.isInteger(srcHeight) || srcHeight <= 0) throw new InvalidFieldError(`srcHeight must be > 0`)
  if (!Number.isInteger(dstWidth)  || dstWidth  <= 0) throw new InvalidFieldError(`dstWidth must be > 0`)
  if (!Number.isInteger(dstHeight) || dstHeight <= 0) throw new InvalidFieldError(`dstHeight must be > 0`)
  if (src.length !== srcWidth * srcHeight) {
    throw new InvalidFieldError(`src.length (${src.length}) !== srcWidth*srcHeight (${srcWidth * srcHeight})`)
  }

  const out = new Float32Array(dstWidth * dstHeight)
  const xScale = (srcWidth  - 1) / Math.max(1, dstWidth  - 1)
  const yScale = (srcHeight - 1) / Math.max(1, dstHeight - 1)

  for (let dy = 0; dy < dstHeight; dy++) {
    const sy = dy * yScale
    const y0 = Math.floor(sy), y1 = Math.min(srcHeight - 1, y0 + 1)
    const fy = sy - y0
    const inv_fy = 1 - fy

    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = dx * xScale
      const x0 = Math.floor(sx), x1 = Math.min(srcWidth - 1, x0 + 1)
      const fx = sx - x0
      const inv_fx = 1 - fx

      const a = src[y0 * srcWidth + x0]!
      const b = src[y0 * srcWidth + x1]!
      const c = src[y1 * srcWidth + x0]!
      const d = src[y1 * srcWidth + x1]!

      out[dy * dstWidth + dx] =
        a * inv_fx * inv_fy +
        b * fx     * inv_fy +
        c * inv_fx * fy     +
        d * fx     * fy
    }
  }

  return out
}
