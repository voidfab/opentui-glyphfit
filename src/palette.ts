/**
 * Colour palette utilities.
 *
 * A palette is an ordered array of `RGBA` colour stops. Sampling at intensity
 * `t ∈ [0, 1]` linearly interpolates between the two adjacent stops:
 *
 *   palette = [black, orange, white]   →   sample(0)   = black
 *                                          sample(0.5) = orange
 *                                          sample(1)   = white
 *
 * Use `paletteFg(palette)` to produce an `intensityToFg` callback you can pass
 * straight to `drawGlyphFit`. The returned function pre-allocates one scratch
 * `RGBA` and overwrites its components per call — it's allocation-free in the
 * hot path.
 */

import { RGBA } from "@opentui/core"
import { InvalidOptionsError } from "./errors.ts"

/** Build a palette from an array of RGBA stops. Must contain ≥ 2 stops. */
export function makePalette(stops: ReadonlyArray<RGBA>): RGBA[] {
  if (stops.length < 2) {
    throw new InvalidOptionsError(`palette requires \u2265 2 stops, got ${stops.length}`)
  }
  return stops.slice()
}

/**
 * Build a palette from CSS-style hex strings. Convenience wrapper over
 * `RGBA.fromHex`.
 *
 * @example
 * ```ts
 * paletteFromHex(["#000", "#f80", "#fff"])  // black → orange → white
 * ```
 */
export function paletteFromHex(hex: ReadonlyArray<string>): RGBA[] {
  if (hex.length < 2) {
    throw new InvalidOptionsError(`palette requires \u2265 2 stops, got ${hex.length}`)
  }
  return hex.map(h => RGBA.fromHex(h))
}

/**
 * Build a palette from `[r, g, b]` or `[r, g, b, a]` tuples in `[0, 1]`.
 *
 * @example
 * ```ts
 * paletteFromValues([[0,0,0], [1,0.5,0], [1,1,1]])
 * ```
 */
export function paletteFromValues(
  stops: ReadonlyArray<readonly [number, number, number] | readonly [number, number, number, number]>,
): RGBA[] {
  if (stops.length < 2) {
    throw new InvalidOptionsError(`palette requires \u2265 2 stops, got ${stops.length}`)
  }
  return stops.map(s => RGBA.fromValues(s[0], s[1], s[2], s[3] ?? 1))
}

/**
 * Sample a palette at `t ∈ [0, 1]`, writing into a caller-provided RGBA.
 * Allocation-free.
 *
 * Values outside `[0, 1]` clamp to the nearest stop.
 */
export function samplePaletteInto(out: RGBA, palette: ReadonlyArray<RGBA>, t: number): void {
  const N = palette.length
  if (N === 0) return
  if (N === 1 || t <= 0) {
    const a = palette[0]!
    out.r = a.r; out.g = a.g; out.b = a.b; out.a = a.a
    return
  }
  if (t >= 1) {
    const a = palette[N - 1]!
    out.r = a.r; out.g = a.g; out.b = a.b; out.a = a.a
    return
  }

  const span = N - 1
  const idxF = t * span
  const i = Math.min(span - 1, Math.floor(idxF))
  const f = idxF - i

  const a = palette[i]!
  const b = palette[i + 1]!
  const inv = 1 - f
  out.r = a.r * inv + b.r * f
  out.g = a.g * inv + b.g * f
  out.b = a.b * inv + b.b * f
  out.a = a.a * inv + b.a * f
}

/**
 * Build an `intensityToFg(avg, fg)` callback that maps cell mean intensity
 * through a palette. Drop-in for `drawGlyphFit`'s `intensityToFg` option.
 *
 * The returned callback re-uses a single `RGBA` instance per draw — DO NOT
 * keep references to its return value across cells; copy via `RGBA.clone(...)`
 * if you need to.
 *
 * @example
 * ```ts
 * import { drawGlyphFit, paletteFg, paletteFromHex, BLOCKS_SHADE } from "opentui-glyphfit"
 *
 * const fire = paletteFg(paletteFromHex(["#000", "#a00", "#f80", "#ff8", "#fff"]))
 *
 * drawGlyphFit(buffer, {
 *   intensities, srcWidth, srcHeight, x: 0, y: 0,
 *   fg: RGBA.fromValues(1, 1, 1, 1),  // ignored when intensityToFg is set
 *   bg: RGBA.fromValues(0, 0, 0, 1),
 *   charset: BLOCKS_SHADE,
 *   intensityToFg: fire,
 * })
 * ```
 */
export function paletteFg(palette: ReadonlyArray<RGBA>): (avg: number, fg: RGBA) => RGBA {
  if (palette.length < 2) {
    throw new InvalidOptionsError(`palette requires \u2265 2 stops, got ${palette.length}`)
  }
  const scratch = RGBA.fromValues(0, 0, 0, 1)
  return (avg: number) => {
    samplePaletteInto(scratch, palette, avg)
    return scratch
  }
}

/* ─── Curated built-in palettes ───────────────────────────────────────────── */

/** Black → red → orange → yellow → white. Classic flame/heatmap. */
export const FIRE: RGBA[] = paletteFromHex([
  "#000000", "#1a0000", "#660000", "#cc3300", "#ff8000", "#ffd700", "#ffffff",
])

/** Black → deep blue → cyan → white. Cool/aquatic. */
export const OCEAN: RGBA[] = paletteFromHex([
  "#000010", "#001a4d", "#003d99", "#0099cc", "#66e0ff", "#ffffff",
])

/** Black → magenta → cyan. Synthwave / cyberpunk. */
export const SYNTHWAVE: RGBA[] = paletteFromHex([
  "#0a0014", "#3d0066", "#a600d9", "#ff33cc", "#33ccff", "#ccffff",
])

/** Phosphor green CRT terminal. Black → dark green → bright green. */
export const PHOSPHOR: RGBA[] = paletteFromHex([
  "#000000", "#003300", "#00cc00", "#66ff66", "#ccffcc",
])

/** Black → purple → red → yellow → white. Inferno/magma — the matplotlib classic. */
export const INFERNO: RGBA[] = paletteFromHex([
  "#000004", "#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925",
  "#fb9b06", "#f7d13d", "#fcffa4",
])

/** Viridis — perceptually uniform, colourblind-friendly. */
export const VIRIDIS: RGBA[] = paletteFromHex([
  "#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779",
  "#6ece58", "#b5de2b", "#fde725",
])

/** Black → gray → white. Pure luminance. */
export const GRAYSCALE: RGBA[] = paletteFromHex(["#000000", "#808080", "#ffffff"])
