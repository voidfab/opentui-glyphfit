import type { Charset, ShapeVector } from "./types.ts"
import { InvalidCharsetError } from "./errors.ts"

/**
 * Charset compiled into typed arrays for cache-friendly hot-loop access.
 *
 *   codepoints[i] gives the codepoint of entry i.
 *   vectors[i*6 .. i*6 + 5] gives the ShapeVector components of entry i.
 *
 * Float32Array is monomorphic and JIT-friendly; 6 sequential reads per entry
 * keep the inner loop in cache and avoid the polymorphic property accesses
 * that come with the `{codepoint, sv: tuple}` object form.
 */
export interface CompiledCharset {
  readonly codepoints: Uint32Array
  readonly vectors: Float32Array
  readonly length: number
}

/**
 * Per-charset cache. Keyed by the source array reference, so calling
 * `compileCharset(BRAILLE)` twice returns the same compiled instance.
 *
 * `WeakMap` keys hold no GC reference; the cache disappears with the charset.
 */
const COMPILE_CACHE = new WeakMap<Charset, CompiledCharset>()

/**
 * Compile a charset to typed arrays, caching the result.
 *
 * Validates that:
 *   - the charset is non-empty
 *   - every entry's ShapeVector has exactly 6 components
 *   - every component is a finite number in [0, 1]
 *   - every codepoint is a non-negative integer
 *
 * Throws `InvalidCharsetError` on any violation.
 */
export function compileCharset(charset: Charset): CompiledCharset {
  const cached = COMPILE_CACHE.get(charset)
  if (cached) return cached

  const N = charset.length
  if (N === 0) {
    throw new InvalidCharsetError("Charset is empty")
  }

  const codepoints = new Uint32Array(N)
  const vectors = new Float32Array(N * 6)

  for (let i = 0; i < N; i++) {
    const entry = charset[i]!
    const cp = entry.codepoint
    if (!Number.isInteger(cp) || cp < 0) {
      throw new InvalidCharsetError(
        `Charset entry ${i} has invalid codepoint ${cp} (must be a non-negative integer)`,
      )
    }
    const sv = entry.sv
    if (!sv || sv.length !== 6) {
      throw new InvalidCharsetError(
        `Charset entry ${i} (codepoint 0x${cp.toString(16)}) has ShapeVector of length ${sv?.length} (expected 6)`,
      )
    }
    codepoints[i] = cp
    for (let k = 0; k < 6; k++) {
      const c = sv[k]!
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        throw new InvalidCharsetError(
          `Charset entry ${i} (codepoint 0x${cp.toString(16)}) has invalid ShapeVector component [${k}]=${c} (must be in [0, 1])`,
        )
      }
      vectors[i * 6 + k] = c
    }
  }

  const compiled: CompiledCharset = { codepoints, vectors, length: N }
  COMPILE_CACHE.set(charset, compiled)
  return compiled
}

/**
 * Hot-loop nearest-neighbour search against a compiled charset.
 * Returns the index of the best entry; the codepoint is `compiled.codepoints[idx]`.
 *
 * Early-exits on exact match (distance 0) — common for solid-space and
 * full-block cells.
 */
export function findBestCharIn(query: ShapeVector, compiled: CompiledCharset): number {
  const v0 = query[0], v1 = query[1], v2 = query[2]
  const v3 = query[3], v4 = query[4], v5 = query[5]
  const vec = compiled.vectors
  const N = compiled.length

  let bestDist = Infinity
  let bestIdx = 0

  for (let i = 0; i < N; i++) {
    const o = i * 6
    const d0 = v0 - vec[o]!
    const d1 = v1 - vec[o + 1]!
    const d2 = v2 - vec[o + 2]!
    const d3 = v3 - vec[o + 3]!
    const d4 = v4 - vec[o + 4]!
    const d5 = v5 - vec[o + 5]!
    const d = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 + d5 * d5
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
      if (d === 0) break
    }
  }

  return bestIdx
}
