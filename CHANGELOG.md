# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Updated the development/test matrix to `@opentui/core` 0.4.x while retaining
  the public `>=0.2.0` peer compatibility floor.

### Fixed
- Build declaration emission now invokes `tsc` through the running Bun
  executable, so builds no longer depend on a separately discoverable `bunx`
  shim in `PATH`.

## [0.6.0] — 2026-05-08

### Added
- **Direct ShapeVector cell drawing** — `drawShapeCells(target, ops, charset)`
  draws pre-computed cell ShapeVectors without sampling an intensity field.
- **Chart-oriented charsets** — `CANDLE`, `CANDLE_BOX`, `SPARK`, `DEPTH`,
  and `AXIS`.
- **Sub-cell ShapeVector builders** — `verticalFill`, `horizontalFill`, and
  `verticalWick`.

## [0.5.0] — 2026-05-06

### Added
- **`renderToImagePixels(options)`** — rasterise the rendered cell grid into
  a flat `Uint8Array` of RGBA bytes at any cell pixel size. Block / shade /
  braille / box characters rasterise analytically from their geometric
  definitions — crisp at any size, no font dependency. ASCII falls back to a
  directional 2×3 ShapeVector fill.

  Returns `{ rgba, width, height }` ready to feed any RGBA-capable PNG
  encoder (pngjs, sharp, browser `ImageData`).

- **PNG output in the image demo's `[s]` save** — four files now drop into
  `screenshots/`: `.txt`, `.ansi.txt`, `.html`, **`.png`**. The PNG is
  2560×1440-class by default and is directly usable as a desktop wallpaper
  on macOS, Linux, and Windows.

  Two new env vars tune the wallpaper output:
    - `GLYPHFIT_PNG_LONG_EDGE` (default `2560`) — long-edge pixel target.
      Bump to `3840` for 4K.
    - `GLYPHFIT_PNG_CELLS_WIDE` (default = on-screen cells) — re-render at
      higher cell density for more detail without resizing the terminal.

- **`src/raster.ts`** — the analytical character rasteriser. Public via
  `renderToImagePixels`, but available as an internal primitive for callers
  building custom encoders.

### Changed
- README — new "Saving frames programmatically" subsection covering
  `renderToImagePixels`, plus an updated demo screenshot table showing all
  four output files.

## [0.4.0] — 2026-05-06

### Added
- **Screenshot rendering** — `renderToText`, `renderToAnsi`, `renderToHtml`,
  `renderAllFormats`. Same input shape as `drawGlyphFit` but produces strings:
    - `.txt`  — plain UTF-8
    - `.ansi.txt` — 24-bit ANSI truecolor escapes (`cat`-able)
    - `.html` — standalone colour-faithful HTML document

  Capture is allocation-light, faithful to the live render, and ignores
  external state (sticky matchers, dirty trackers) so it's a pure function of
  the inputs.

- **`[s]` save hotkey in both demos** (`comparison.ts`, `image.ts`).
  Writes timestamped `.txt` + `.ansi.txt` + `.html` triplets to
  `screenshots/` (override with `GLYPHFIT_SCREENSHOT_DIR`). A green toast
  banner replaces the title bar for ~4 seconds confirming the save.

- **Pure-JS image decoders in the image demo** (`pngjs`, `jpeg-js`, both
  devDependencies). Replaces the previous ImageMagick shell-out so the demo
  works on any machine without external tools.

## [0.3.0] — 2026-05-06

Creative-feature release. Three new visual capabilities + a runtime regression
fix. No breaking changes from 0.2.0.

### Added
- **Colour palettes** — map cell mean intensity through an RGBA colour ramp.
  Built-ins: `FIRE`, `OCEAN`, `SYNTHWAVE`, `PHOSPHOR`, `INFERNO`, `VIRIDIS`,
  `GRAYSCALE`. Plus `paletteFromHex`, `paletteFromValues`, `paletteFg`,
  `samplePaletteInto`, `makePalette`. Allocation-free in the hot path — the
  `paletteFg` callback re-uses one scratch `RGBA` instance.
- **`StickyMatcher`** — frame-to-frame char hysteresis to suppress shimmer at
  Voronoi boundaries in charset space. Wire into any `drawGlyphFit` call via
  the new `sticky` option. ~5% hot-path overhead; resets cleanly on charset
  switches via `sticky.reset()`.
- **`intensityFromPixels`** — convert decoded `Uint8Array | Uint8ClampedArray`
  pixel data into a `Float32Array` intensity field. Five luminance formulas
  (`rec709`, `rec601`, `average`, `max`, `alpha`), plus invert / gamma /
  premultiply-alpha options. Accepts 1, 3, or 4-channel input.
- **`resampleIntensity`** — bilinear resample for fitting decoded images to
  arbitrary destination grids (e.g. 1024×1024 image → 600×240 supersampled cells).
- **`demos/image.ts`** — runnable demo: render any PNG/JPEG as terminal art,
  pickable charset and palette. Decodes via ImageMagick (no heavy decoder dep).
- **`tests/demo.test.ts`** — runtime smoke test for the
  `setFrameCallback` + `FrameBufferRenderable` code path used by the demo.
  Covers the integration that mock-buffer + `addPostProcessFn` tests miss.

### Changed
- `tsconfig.json` includes `demos/`, `bench/`, `scripts/` in typecheck scope.
  Previously only `src/` and `tests/` were typechecked, which is why the
  0.2.0 release missed an undeclared-variable bug in `demos/comparison.ts`.
- `comparison.ts` demo wires in the new `StickyMatcher` (right panel only).
- README — added live GIFs of three reference scenes (checkers/braille,
  sphere/box, torus/ascii) plus full docs for the three new capabilities.

### Fixed
- `demos/comparison.ts` referenced an undeclared `leftBuf` variable, causing
  the frame callback to throw silently (panels rendered empty). The earlier
  edit declaring `let leftBuf = new Float32Array(0)` had failed silently.
  Demo is now properly typechecked.

### Performance
No regressions; full bench suite still hits the same numbers as 0.2.0.

## [0.2.0] — 2026-05-06

A correctness, robustness, and performance overhaul. Pre-1.0 — there are
breaking changes; see Migration below.

### Added
- **`destWidth` / `destHeight`** options on `drawGlyphFit` — explicit destination
  region size in cells. Defaults to filling from `(x, y)` to the buffer edge.
  Fixes silent horizontal-squish when drawing into a non-full-width region.
- **`intensityToFg(avg, fg)` callback** for tonal modulation of foreground
  colour per cell. Useful for small charsets (BOX, SHADE) where character
  sparsity alone does not encode tonal range.
- **`drawGlyphFitColor`** — colour-aware renderer. Per cell: 1-iteration k=2
  k-means partitions source pixels into bright/dark clusters, assigns them as
  fg/bg, and matches the binary spatial mask against a charset to pick a
  directional character. Eliminates banding on smooth-shaded surfaces.
- **`compileCharset` / `findBestCharIn`** — explicit typed-array compiled form
  of a charset (Uint32Array codepoints + Float32Array vectors). The hot path
  now runs over typed arrays instead of object property reads. Cached per
  charset via `WeakMap`.
- **`sampleShapeVectorInto(out, ...)`** — allocation-free sampling variant.
  `drawGlyphFit` reuses a single 6-element tuple across all cells of a frame.
- **Structured error hierarchy**: `GlyphFitError` (base), `InvalidFieldError`,
  `InvalidCharsetError`, `InvalidOptionsError`. All public APIs validate input
  and throw these types.
- **`unsafe: true` opt-out** for callers who want to skip validation in tight
  loops.
- **`buildCharset` accepts mixed entries** — `number | [codepoint, ShapeVector]`,
  so callers can mix built-in codepoints with custom shapes.
- **Performance benchmark suite** at `bench/index.ts`.
- **Snapshot tests** (`tests/snapshots.test.ts`) pin the visual output of
  every charset against deterministic gradient/disc/diagonal/plasma fields.
- **Real-buffer integration tests** (`tests/integration.test.ts`) using
  `@opentui/core/testing`.
- **Performance regression tests** (`tests/perf.test.ts`).
- **Structural-invariant tests** that catch every "0.43 vs 0x43" / duplicate-
  codepoint / out-of-range-component bug across all charsets via
  `describe.each`.

### Changed (breaking)
- `fg` / `bg` in `DrawGlyphFitOptions` are now typed as `RGBA` (from
  `@opentui/core`). Plain `{r,g,b,a}` literals no longer typecheck. Use
  `RGBA.fromValues(...)`.
- **Sampling switched to area-weighted contribution.** Each source pixel
  contributes to all 6 sub-regions in proportion to its area overlap rather
  than being assigned to a single discrete band. This fixes a previously
  silent bug: at 2× supersampling, the bottom row band always had zero
  pixels — every sample ended up in `top` or `mid`, the bot-row component
  was always 0. Output of `sampleShapeVector` differs slightly from 0.1.0
  for the same input (it is now correct).
- `findBestChar(query, charset)` now throws `InvalidCharsetError` on empty
  charset (previously: TypeError accessing `charset[0]`).
- `drawGlyphFit` validates inputs by default (NaN, length mismatch, gamma,
  threshold, dest dims, charset). Pass `unsafe: true` to bypass.
- `sampleShapeVector` parameter renamed: `termWidth`/`termHeight` →
  `destWidth`/`destHeight` (the names always meant "destination region",
  never "buffer dimensions"; the rename matches reality).

### Fixed
- ASCII charset: codepoint for `'C'` was the float `0.43` instead of `0x43`.
  `'C'` was effectively missing from ASCII matching.
- BLOCKS charset: `U+2584` (lower half) was duplicated — once as `LOWER_HALF`,
  once via `lowerEighth(4)`. Removed the duplicate.
- Sampling silently produced incorrect output at 2× supersampling because the
  integer pixel-band assignment never reached the bot-row band (see Changed).
- NaN / Infinity values in the source field could produce NaN ShapeVector
  components and undefined character selection. They are now treated as 0.

### Performance
Benchmarks at 200×50 (3× supersampling, plasma input), measured on M2 MacBook Air:
  - BRAILLE       (256 chars):   6.0  ms/frame  (was ~17 ms/frame in 0.1.0)
  - BLOCKS_SHADE  ( 25 chars):   1.3  ms/frame
  - BLOCKS        ( 22 chars):   1.2  ms/frame
  - BOX           ( 22 chars):   1.2  ms/frame
  - ASCII         ( 95 chars):   2.5  ms/frame
  - SHADE         (  4 chars):   0.9  ms/frame
  - empty field   (any charset): 0.16 ms/frame  (threshold-first cheap pass)

### Migration

```diff
  import { drawGlyphFit, BLOCKS_SHADE } from "opentui-glyphfit"
+ import { RGBA } from "@opentui/core"

  drawGlyphFit(buffer, {
    intensities, srcWidth, srcHeight,
    x: 10, y: 0,
+   destWidth: 50,        // newly required if you draw into a sub-region
+   destHeight: 30,
-   fg: { r: 1, g: 1, b: 1, a: 1 },
-   bg: { r: 0, g: 0, b: 0, a: 1 },
+   fg: RGBA.fromValues(1, 1, 1, 1),
+   bg: RGBA.fromValues(0, 0, 0, 1),
    charset: BLOCKS_SHADE,
  })
```

If you were previously calling without `destWidth` / `destHeight` and the
destination *was* the full buffer width — no change is needed; the defaults
preserve that behaviour.

## [0.1.0] — 2026-05-05

Initial release.
- 6-point spatial sampling → nearest-neighbour charset match
- BRAILLE (256), BLOCKS, SHADE, BLOCKS_SHADE, BOX, ASCII charsets
- `drawGlyphFit`, `sampleField`, `matchField`, `shapeOf`, `buildCharset`
- 50 unit tests
