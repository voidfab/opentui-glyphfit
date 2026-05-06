# opentui-glyphfit — Design Document

## 1. Purpose

`opentui-glyphfit` is a pure TypeScript plugin for OpenTUI that replaces the
existing `drawGrayscaleBuffer` pipeline with direction-aware, charset-flexible
character selection.

OpenTUI currently maps a float intensity value to a character by ranking 71
ASCII chars from least to most ink density and doing a linear array lookup:

```
intensity 0.47 → GRAYSCALE_CHARS[33] → 'i'
```

This throws away *where* within the character cell the intensity falls. A
diagonal edge, a horizontal bar, and a dot cluster of the same average density
all produce the same character.

`opentui-glyphfit` replaces that 1D lookup with a 6-point spatial sample →
nearest-neighbour match in a pre-built charset table:

```
cell region samples:
  [0.0, 0.8]   ← top:  ink on right only
  [0.2, 0.6]   ← mid:  diagonal crossing
  [0.7, 0.1]   ← bot:  ink on left only
→ findBestChar(v, BRAILLE) → '⠳'
```

---

## 2. Problem Statement

### 2.1 What OpenTUI cannot currently do

| Scenario | Current behaviour | Desired behaviour |
|---|---|---|
| Diagonal edge in 3D render | All cells ≈ same density → `i` or `l` | Cells get `/` or `\` matching edge direction |
| Sharp facet boundary | Blurs into density gradient | Preserves edge sharpness via directional chars |
| Braille as render target | Not supported | Full 256-state braille (2×4 dots per cell) |
| Charset selection at call site | Hardcoded `GRAYSCALE_CHARS` in Zig | Caller picks: braille / blocks / ASCII / box / custom |
| Sub-cell resolution | 1 sample per cell → 71 states | 6 samples per cell → up to 256 states (braille) |

### 2.2 Root cause

`OptimizedBuffer.drawGrayscaleBuffer` calls into Zig which does:

```zig
const GRAYSCALE_CHARS = " .'^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

fn getGrayscaleChar(intensity: f32) u32 {
    const index: usize = @intFromFloat(clamped * 70.0);
    return GRAYSCALE_CHARS[index];  // purely density ranked
}
```

The 6D spatial information that *exists* in the source intensity field is
discarded before character selection.

---

## 3. Non-Goals

- **No dependency on `phosphor` or `thermite`** — those packages come from an
  unknown author. All shape data in this library is independently derived.
- **No Zig native code** — operates entirely over the public TypeScript API of
  `@opentui/core` (`OptimizedBuffer.drawChar`). No FFI symbols are added.
- **Not a general image-to-ASCII converter** — scoped to intensity fields
  (Float32Array) as produced by 3D renderers and depth maps.
- **No color char selection** — that path (quadrant blocks with RGBA fg/bg) is
  already well handled by `drawSuperSampleBuffer`. This library targets
  single-color intensity rendering.
- **No font rasterisation** — shape vectors for all charsets are derived
  analytically from the mathematical structure of each character, not by
  rendering them through a font.

---

## 4. Approach

### 4.1 Shape Vector

A **ShapeVector** is a 6-element `Float32Array` representing the expected ink
coverage at 6 sample points arranged in a 2-column × 3-row grid within one
terminal character cell:

```
column:  left   right
        ┌─────┬─────┐
top     │ v[0]│ v[1]│  y ≈ 1/6 of cell height
        ├─────┼─────┤
mid     │ v[2]│ v[3]│  y ≈ 3/6 of cell height
        ├─────┼─────┤
bot     │ v[4]│ v[5]│  y ≈ 5/6 of cell height
        └─────┴─────┘
        x≈1/4  x≈3/4
```

All values in [0, 1]. The distance between two ShapeVectors is Euclidean in ℝ⁶.

### 4.2 Charset Table

A **Charset** is a pre-built array of `{ codepoint: number, sv: ShapeVector }`
entries sorted by a canonical ordering. At startup each charset is computed
once. During rendering, `findBestChar` does a linear scan and returns the entry
with the smallest Euclidean distance to the query vector.

### 4.3 Rendering Flow

```
Float32Array (intensity field, srcW × srcH)
        │
        ▼ sampleShapeVector(intensities, srcW, srcH, cellX, cellY, termW, termH)
ShapeVector  ──── per terminal cell
        │
        ▼ findBestChar(sv, charset)
{ codepoint, sv }
        │
        ▼ buffer.drawChar(codepoint, termX, termY, fg, bg)
OptimizedBuffer cell
```

### 4.4 Supersampling

When the source intensity field has more pixels than terminal cells (e.g., a
3D render at 2× resolution), `sampleShapeVector` averages the pixels covering
each of the 6 sub-regions rather than sampling a single point. This preserves
more information than the current `drawGrayscaleBufferSupersampled` (which
averages all 4 pixels into one float before char selection).

---

## 5. Shape Data Derivation (Cleanroom Rationale)

All shape vectors are derived from first principles, not copied from any other
library.

### 5.1 Block and Half-Block Characters

These divide the cell into mathematically defined rectangular regions. Coverage
at each of the 6 sample points is 1 if the point falls inside the character's
ink region, 0 otherwise, with linear interpolation at boundaries.

Examples:
```
▀ UPPER HALF BLOCK  → [1, 1, 0.5, 0.5, 0, 0]
▄ LOWER HALF BLOCK  → [0, 0, 0.5, 0.5, 1, 1]
▌ LEFT HALF BLOCK   → [1, 0, 1,   0,   1, 0]
▐ RIGHT HALF BLOCK  → [0, 1, 0,   1,   0, 1]
█ FULL BLOCK        → [1, 1, 1,   1,   1, 1]
  SPACE             → [0, 0, 0,   0,   0, 0]
```

Quadrant blocks follow the same logic with their respective ¼-cell regions.

### 5.2 Braille Characters (U+2800–U+28FF)

Unicode braille encodes 8 dots in a 2-column × 4-row grid. Bit positions:

```
Bit 0 (0x01): dot 1 — top-left      Bit 3 (0x08): dot 4 — top-right
Bit 1 (0x02): dot 2 — mid-upper-L   Bit 4 (0x10): dot 5 — mid-upper-R
Bit 2 (0x04): dot 3 — mid-lower-L   Bit 5 (0x20): dot 6 — mid-lower-R
Bit 6 (0x40): dot 7 — bot-left      Bit 7 (0x80): dot 8 — bot-right
```

Dot rows sit at ≈ 1/8, 3/8, 5/8, 7/8 of cell height.
ShapeVector sample rows sit at 1/6, 3/6, 5/6 of cell height.

Mapping (analytically minimising sample-to-dot distance):
```
v[0] = d1                   (top-left sample ↔ dot-1 at 1/8)
v[1] = d4                   (top-right sample ↔ dot-4 at 1/8)
v[2] = (d2 + d3) / 2        (mid sample ↔ dots 2+3 straddle 3/6)
v[3] = (d5 + d6) / 2        (mid sample ↔ dots 5+6 straddle 3/6)
v[4] = d7                   (bot-left sample ↔ dot-7 at 7/8)
v[5] = d8                   (bot-right sample ↔ dot-8 at 7/8)
```

All 256 braille codepoints are generated algorithmically from this formula.

### 5.3 Box Drawing Characters

Horizontal lines have ink at y ≈ ½: they register strongly in the mid row of
the ShapeVector. Vertical lines have ink across all y values but centered in x:
they register equally across all rows with slightly elevated values (since the
sample points at x=¼ and x=¾ are not at the centre where the line lives).
Corners and T-junctions are sums of their constituent line segments.

### 5.4 ASCII Characters

Structurally derived approximations for printable ASCII (0x20–0x7E). Characters
are classified by their dominant visual feature:

- Diagonal `/` `\`: high coverage in the two cross-cells, low elsewhere
- Horizontal `-` `_` `=`: mid/bot row dominance, left-right symmetric
- Vertical `|` `!`: column-symmetric, all rows medium
- Dense `@` `#` `W` `M`: uniformly high
- Sparse `.` `'` `` ` ``: single row, one side
- Intermediate letters: structurally approximated from stroke geometry

These approximations will not be identical to any measured font rendering,
which is intentional for cleanroom isolation.

### 5.5 Shade Characters

`░` `▒` `▓` are uniform-intensity characters with analytically defined
densities (0.25, 0.5, 0.75 respectively across all 6 components).

---

## 6. API Design

### 6.1 Core function (drop-in for drawGrayscaleBuffer)

```typescript
import { drawGlyphFit } from "opentui-glyphfit"

drawGlyphFit(buffer, {
  intensities: Float32Array,  // srcW × srcH intensity values [0..1]
  srcWidth:    number,
  srcHeight:   number,
  x:           number,        // destination cell X in buffer
  y:           number,        // destination cell Y in buffer
  fg:          RGBA,          // foreground colour for ink
  bg:          RGBA,          // background colour
  charset:     Charset,       // BRAILLE | BLOCKS | ASCII | BOX | SHADE | custom
})
```

### 6.2 Built-in charsets

```typescript
import { Charset } from "opentui-glyphfit"

Charset.BRAILLE        // 256 entries — highest spatial resolution
Charset.BLOCKS         // 19 entries — block + half-block + quadrant
Charset.SHADE          // 4 entries  — space + ░▒▓
Charset.BOX            // ~30 entries — box drawing primitives
Charset.ASCII          // ~95 entries — printable ASCII
Charset.BLOCKS_SHADE   // BLOCKS ∪ SHADE — good general purpose
```

### 6.3 Custom charsets

```typescript
import { buildCharset, shapeOf } from "opentui-glyphfit"

const myCharset = buildCharset([
  0x2588,  // █
  0x2580,  // ▀
  0x2584,  // ▄
  0x2800 + 0b10101010,  // arbitrary braille
])
```

### 6.4 Low-level access

```typescript
import { sampleShapeVector, findBestChar, shapeOf } from "opentui-glyphfit"

const sv = sampleShapeVector(intensities, srcW, srcH, cellX, cellY, termW, termH)
const { codepoint } = findBestChar(sv, Charset.BRAILLE)
const knownSv = shapeOf(0x2580)  // get ShapeVector for a known codepoint
```

---

## 7. Integration with OpenTUI

The plugin has a **single peer dependency**: `@opentui/core`. It imports only:

```typescript
import type { OptimizedBuffer, RGBA } from "@opentui/core"
```

It calls only the public method:

```typescript
buffer.drawChar(codepoint: number, x: number, y: number, fg: RGBA, bg: RGBA)
```

No native Zig code. No FFI. No internal OpenTUI APIs. No peer package version
pinning beyond the `drawChar` signature which has been stable since OpenTUI's
initial release.

---

## 8. Performance Characteristics

| Operation | Cost | Notes |
|---|---|---|
| Charset build (BRAILLE, 256 chars) | O(256) × O(6) = once at init | Pre-built, frozen |
| sampleShapeVector | O(pixels-per-cell) | 6 sub-regions × supersampling factor |
| findBestChar (BRAILLE, 256 entries) | O(256 × 6) multiplies | ~1536 float ops |
| Per-frame total (220×50 terminal) | 220×50×1536 ≈ 17M float ops | ~0.5ms on modern JS engine at 30fps |

For 120fps with a 200-column terminal the budget is ~8ms/frame. At ~17M float
ops this is comfortable in V8/Bun at JIT warmup speeds. No SIMD or Zig
optimisation is needed at this scale.

If a future benchmark shows it is too slow, the `findBestChar` inner loop is
the obvious Zig candidate (isolated, zero-allocation, pure compute).

---

## 9. Measures of Success

### Correctness
- [ ] A horizontal line in the intensity field produces predominantly `-` or `─` chars
- [ ] A 45° diagonal produces predominantly `/` or `\` chars
- [ ] A vertical line produces predominantly `|` or `│` chars
- [ ] Full intensity produces `█`; zero intensity produces ` `
- [ ] All 256 braille ShapeVectors are distinct (no duplicates after mapping)
- [ ] `findBestChar(shapeOf(cp), charset)` round-trips correctly for every char in charset

### Quality
- [ ] Braille rendering of a smooth gradient has no banding artefacts
- [ ] Crystal/gem shape rendered through `@opentui/three` → glyphfit shows visibly sharper facet edges than `drawGrayscaleBuffer`

### Integration
- [ ] Works as a drop-in for `drawGrayscaleBuffer` with no renderer changes
- [ ] Zero dependencies beyond `@opentui/core` peer
- [ ] `bun test` passes on macOS aarch64, Linux x86_64

### Performance
- [ ] `drawGlyphFit` on a 200×50 terminal completes in < 5ms on a 2023-era machine
- [ ] No allocations in the hot path after charset build

---

## 10. Implementation Phases

### Phase 1 — Core (this PR)
- ShapeVector type + distance function
- Braille charset (analytical, all 256)
- Block + shade charsets (analytical)
- `sampleShapeVector` + `findBestChar`
- `drawGlyphFit` function
- Unit tests for round-trip correctness

### Phase 2 — Charsets
- Box drawing charset
- ASCII charset (structural approximations)
- `buildCharset` from arbitrary codepoint array
- `shapeOf` for individual codepoint lookup

### Phase 3 — Quality
- Contrast / gamma correction option on sample
- LUT caching option for fixed-size intensity fields
- Crystal/gem demo using `@opentui/three` + glyphfit
