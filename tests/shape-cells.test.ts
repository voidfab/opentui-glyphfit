import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { CANDLE, drawShapeCells, type BufferLike, type ShapeCellOp } from "../src/index.ts"

const FG = RGBA.fromValues(1, 1, 1, 1)
const BG = RGBA.fromValues(0, 0, 0, 1)

class TestBuffer implements BufferLike {
  readonly width = 4
  readonly height = 2
  readonly chars: Array<{ char: number, x: number, y: number, attributes?: number }> = []

  drawChar(char: number, x: number, y: number, _fg: RGBA, _bg: RGBA, attributes?: number): void {
    this.chars.push({ char, x, y, ...(attributes !== undefined ? { attributes } : {}) })
  }
}

describe("drawShapeCells", () => {
  test("matches ShapeVectors through a compiled charset", () => {
    const buffer = new TestBuffer()
    const ops: ShapeCellOp[] = [
      { x: 1, y: 0, sv: [1, 1, 1, 1, 1, 1], fg: FG, bg: BG },
    ]

    drawShapeCells(buffer, ops, CANDLE)
    expect(buffer.chars).toEqual([{ char: 0x2588, x: 1, y: 0 }])
  })

  test("explicit codepoints bypass charset matching", () => {
    const buffer = new TestBuffer()
    const ops: ShapeCellOp[] = [
      { x: 2, y: 1, sv: [0, 0, 0, 0, 0, 0], fg: FG, bg: BG, cp: 0x2502, attributes: 7 },
    ]

    drawShapeCells(buffer, ops, CANDLE)
    expect(buffer.chars).toEqual([{ char: 0x2502, x: 2, y: 1, attributes: 7 }])
  })
})
