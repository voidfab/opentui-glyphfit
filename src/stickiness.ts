/**
 * Temporal stickiness — eliminate per-frame char flicker for cells whose
 * ShapeVector sits near a Voronoi boundary in charset space.
 *
 * A "Voronoi boundary" cell is one where the second-best charset entry has a
 * distance very close to the best. Tiny frame-to-frame noise (e.g. an
 * animation easing through a threshold) causes the choice to flip, producing
 * visible shimmer in otherwise smooth gradients.
 *
 * `StickyMatcher` resolves this by remembering each cell's previous-frame
 * codepoint. If the previous codepoint's SV is within `tolerance²` of the new
 * best, it sticks with the previous codepoint. The cell only flips when the
 * new best is *meaningfully* better.
 *
 * Cost: one Uint32Array(W*H) of cached codepoints + a per-cell SV lookup. ~5%
 * overhead on the hot path.
 */

import type { Charset, ShapeVector } from "./types.ts"
import type { CompiledCharset } from "./compiled-charset.ts"
import { compileCharset, findBestCharIn } from "./compiled-charset.ts"

export interface StickyMatcherOptions {
  /**
   * Squared-distance tolerance: if the previous frame's chosen char has SV
   * within `tolerance` of the current best, keep it. Default 0.05 — about
   * one ~22% intensity step on a single component.
   *
   * Set to 0 to disable stickiness (equivalent to plain `findBestCharIn`).
   */
  tolerance?: number
}

/**
 * A reusable per-cell sticky matcher. Scope it to one rendering region
 * (e.g. the right panel of a comparison demo), call `resize` when the region
 * dimensions change, and call `match(sv, cellIdx, compiled)` each frame.
 */
export class StickyMatcher {
  private prev: Uint32Array
  private hasPrev: Uint8Array
  private W = 0
  private H = 0
  private readonly tolerance: number

  constructor(opts: StickyMatcherOptions = {}) {
    this.tolerance = opts.tolerance ?? 0.05
    this.prev = new Uint32Array(0)
    this.hasPrev = new Uint8Array(0)
  }

  /** Set the cell-grid dimensions. Resets cached state. */
  resize(width: number, height: number): void {
    if (width === this.W && height === this.H) return
    this.W = width
    this.H = height
    this.prev = new Uint32Array(width * height)
    this.hasPrev = new Uint8Array(width * height)
  }

  /** Discard all cached state. Use when you want hard cuts (mode/charset switch). */
  reset(): void {
    this.hasPrev.fill(0)
  }

  /**
   * Match a query ShapeVector against the compiled charset, applying
   * stickiness against the previous frame's codepoint at `cellIdx`.
   *
   * Returns the codepoint to draw and updates the per-cell cache.
   */
  match(sv: ShapeVector, cellIdx: number, compiled: CompiledCharset): number {
    const newIdx = findBestCharIn(sv, compiled)
    const newCp = compiled.codepoints[newIdx]!

    if (this.tolerance <= 0 || cellIdx >= this.prev.length || !this.hasPrev[cellIdx]) {
      this.prev[cellIdx] = newCp
      this.hasPrev[cellIdx] = 1
      return newCp
    }

    const prevCp = this.prev[cellIdx]!
    if (prevCp === newCp) return newCp

    // Compute distance from sv to the previous codepoint's SV. If close
    // enough to the new best, keep the previous to suppress shimmer.
    const prevSvIdx = lookupSvIndex(compiled, prevCp)
    if (prevSvIdx < 0) {
      this.prev[cellIdx] = newCp
      return newCp
    }

    const vec = compiled.vectors
    const o = prevSvIdx * 6
    const d0 = sv[0] - vec[o]!,     d1 = sv[1] - vec[o + 1]!
    const d2 = sv[2] - vec[o + 2]!, d3 = sv[3] - vec[o + 3]!
    const d4 = sv[4] - vec[o + 4]!, d5 = sv[5] - vec[o + 5]!
    const dPrev = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5

    // Distance to the new best.
    const o2 = newIdx * 6
    const e0 = sv[0] - vec[o2]!,     e1 = sv[1] - vec[o2 + 1]!
    const e2 = sv[2] - vec[o2 + 2]!, e3 = sv[3] - vec[o2 + 3]!
    const e4 = sv[4] - vec[o2 + 4]!, e5 = sv[5] - vec[o2 + 5]!
    const dNew = e0 * e0 + e1 * e1 + e2 * e2 + e3 * e3 + e4 * e4 + e5 * e5

    if (dPrev - dNew <= this.tolerance) {
      // Previous codepoint is still close enough — keep it (no flip).
      return prevCp
    }

    this.prev[cellIdx] = newCp
    return newCp
  }
}

/**
 * Linear scan to recover an entry's vector index from its codepoint.
 * Charsets are typically tiny (≤ 256 entries) so this stays cache-friendly;
 * called only on the rare flip-candidate path, not in the hot loop.
 */
function lookupSvIndex(compiled: CompiledCharset, codepoint: number): number {
  const cps = compiled.codepoints
  for (let i = 0; i < cps.length; i++) if (cps[i] === codepoint) return i
  return -1
}

/* ─── Convenience: a stand-alone wrapper around drawGlyphFit ──────────────── */

/**
 * Compose a sticky matcher into a glyphfit-compatible drawing pipeline by
 * pre-compiling the charset and exposing per-cell matching with hysteresis.
 *
 * Most users should pass `StickyMatcher` directly to a custom renderer; this
 * factory is for callers who want the simplest possible upgrade path.
 */
export function makeStickyCompiled(charset: Charset, opts?: StickyMatcherOptions): {
  compiled: CompiledCharset
  matcher: StickyMatcher
} {
  return { compiled: compileCharset(charset), matcher: new StickyMatcher(opts) }
}
