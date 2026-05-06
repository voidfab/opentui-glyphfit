import type { RGBA } from "@opentui/core"

/**
 * A 6-element tuple representing ink coverage at 6 sample points within one
 * terminal character cell, arranged in a 2-column × 3-row grid:
 *
 *   col:  left  right
 *        ┌────┬────┐
 *   top  │ v0 │ v1 │  y ≈ 1/6 of cell height, x ≈ 1/4 and 3/4 of cell width
 *        ├────┼────┤
 *   mid  │ v2 │ v3 │  y ≈ 3/6
 *        ├────┼────┤
 *   bot  │ v4 │ v5 │  y ≈ 5/6
 *        └────┴────┘
 *
 * All values in [0, 1].
 *
 * The tuple is intentionally mutable so `sampleShapeVector` can fill into a
 * caller-provided buffer (see `sampleShapeVectorInto`). For charset entries the
 * tuple is frozen via `Object.freeze` at module load.
 */
export type ShapeVector = [number, number, number, number, number, number]

/** A single entry in a Charset: the Unicode codepoint and its ShapeVector. */
export interface CharEntry {
  readonly codepoint: number
  readonly sv: ShapeVector
}

/**
 * A pre-built collection of CharEntry values ready for matching.
 * Built once at module load; `findBestChar` scans this array linearly.
 *
 * For high-throughput rendering, charsets are auto-compiled to a typed-array
 * representation on first use (see `compileCharset`).
 */
export type Charset = readonly CharEntry[]

/**
 * Options for `drawGlyphFit`.
 *
 * The destination region is `destWidth × destHeight` cells, anchored at `(x, y)`.
 * If `destWidth`/`destHeight` are omitted, the region fills from `(x, y)` to the
 * bottom-right corner of the buffer.
 */
export interface DrawGlyphFitOptions {
  /** Float32Array of intensity values, one per source pixel, row-major. */
  intensities: Float32Array

  /** Width of the source intensity field in pixels. Must be > 0. */
  srcWidth: number

  /** Height of the source intensity field in pixels. Must be > 0. */
  srcHeight: number

  /** Destination X position in terminal cells within the buffer. */
  x: number

  /** Destination Y position in terminal cells within the buffer. */
  y: number

  /** Width of the destination region in cells. Defaults to `buffer.width - x`. */
  destWidth?: number

  /** Height of the destination region in cells. Defaults to `buffer.height - y`. */
  destHeight?: number

  /** Foreground colour. */
  fg: RGBA

  /** Background colour. */
  bg: RGBA

  /** Character set to use for matching. Defaults to `BRAILLE`. */
  charset?: Charset

  /**
   * Gamma correction exponent applied to each sample before matching.
   * Values > 1 increase contrast; < 1 compress it. Defaults to 1.
   */
  gamma?: number

  /**
   * Minimum intensity below which a cell is skipped (left as background).
   * Defaults to 0.02.
   */
  threshold?: number

  /**
   * Optional callback to modulate the foreground colour per cell by mean
   * intensity. Useful for small charsets (BOX, SHADE) where character
   * sparsity alone does not encode tonal range.
   *
   * Called once per drawn cell with `avg ∈ (threshold, 1]`. Returning the
   * input `fg` unchanged is equivalent to omitting this option.
   *
   * NOTE: avoid allocating new RGBA instances inside this callback in hot
   * loops — pre-allocate a small palette and return references.
   */
  intensityToFg?: (avg: number, fg: RGBA) => RGBA

  /**
   * Skip input validation (gamma, threshold, dims, NaN). Defaults to false.
   * Set true after profiling shows validation cost is non-trivial AND you
   * fully trust your inputs.
   */
  unsafe?: boolean

  /**
   * Optional `StickyMatcher` to suppress per-cell char flicker between frames.
   * Resize the matcher to match `(destWidth, destHeight)` before passing it
   * in. See `src/stickiness.ts`.
   */
  sticky?: import("./stickiness.ts").StickyMatcher
}

/**
 * The minimal interface this library needs from an OpenTUI `OptimizedBuffer`.
 * Accepting this interface (instead of importing the concrete class) means
 * tests don't need to construct a real native-backed buffer.
 */
export interface BufferLike {
  readonly width: number
  readonly height: number
  drawChar(char: number, x: number, y: number, fg: RGBA, bg: RGBA, attributes?: number): void
}
