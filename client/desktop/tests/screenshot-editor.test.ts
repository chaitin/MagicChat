import assert from "node:assert/strict"
import test from "node:test"
import {
  moveSelection,
  normalizeSelection,
  resizeSelection,
  toolbarPosition,
  annotationCanvasPoint,
  drawAnnotations,
  windowAtPoint,
} from "../src/renderer/screenshot-editor.ts"

test("反向拖动与屏幕边界得到有效截图区域", () => {
  assert.deepEqual(
    normalizeSelection({ x: 350, y: 240 }, { x: -20, y: 900 }, { width: 800, height: 600 }),
    {
      x: 0,
      y: 240,
      width: 350,
      height: 360,
    },
  )
})

test("工具栏优先贴在选区下方，靠近底部时移动到上方", () => {
  const screen = { width: 800, height: 600 }
  const toolbar = { width: 330, height: 44 }
  assert.deepEqual(toolbarPosition({ x: 200, y: 100, width: 200, height: 100 }, screen, toolbar), {
    x: 70,
    y: 208,
  })
  assert.deepEqual(toolbarPosition({ x: 200, y: 520, width: 200, height: 50 }, screen, toolbar), {
    x: 70,
    y: 468,
  })
  const atEdge = toolbarPosition({ x: 760, y: 0, width: 40, height: 600 }, screen, toolbar)
  assert.equal(atEdge.x, 462)
  assert.ok(atEdge.y >= 8 && atEdge.y + toolbar.height <= screen.height - 8)
})

test("八方向手柄缩放保持选区在屏内且不会翻转", () => {
  const original = { x: 100, y: 120, width: 200, height: 100 }
  const viewport = { width: 400, height: 300 }
  assert.deepEqual(resizeSelection(original, "nw", { x: 30, y: 40 }, viewport), {
    x: 130,
    y: 160,
    width: 170,
    height: 60,
  })
  assert.deepEqual(resizeSelection(original, "e", { x: 500, y: 0 }, viewport), {
    x: 100,
    y: 120,
    width: 300,
    height: 100,
  })
  assert.deepEqual(resizeSelection(original, "sw", { x: 500, y: 500 }, viewport), {
    x: 280,
    y: 120,
    width: 20,
    height: 180,
  })
  assert.deepEqual(moveSelection(original, { x: -200, y: 300 }, viewport), {
    x: 0,
    y: 200,
    width: 200,
    height: 100,
  })
})

test("移动或缩放选区时，标注仍对应原屏幕像素", () => {
  const point = { x: 160, y: 180 }
  const initial = { x: 100, y: 120, width: 200, height: 100 }
  assert.deepEqual(annotationCanvasPoint(point, initial, 2, 2), { x: 120, y: 120 })
  assert.deepEqual(
    annotationCanvasPoint(
      point,
      moveSelection(initial, { x: 30, y: 10 }, { width: 400, height: 300 }),
      2,
      2,
    ),
    { x: 60, y: 100 },
  )
  assert.deepEqual(
    annotationCanvasPoint(
      point,
      resizeSelection(initial, "nw", { x: 20, y: 20 }, { width: 400, height: 300 }),
      2,
      2,
    ),
    { x: 80, y: 80 },
  )
})

test("马赛克只沿笔迹使用像素画，橡皮擦恢复底图，文字使用屏幕坐标", () => {
  const previousDocument = globalThis.document
  const operations: string[] = []
  const base = { width: 200, height: 200 } as HTMLCanvasElement
  let pixelated: { width: number; height: number; getContext: () => object } | undefined
  globalThis.document = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => operations.push("draw pixels"),
          set imageSmoothingEnabled(value: boolean) {
            operations.push(`smoothing ${value}`)
          },
        }),
      }
      pixelated = canvas
      return canvas
    },
  } as unknown as Document
  try {
    let patternSource: object | undefined
    const context = {
      canvas: base,
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      moveTo: (x: number, y: number) => operations.push(`move ${x} ${y}`),
      lineTo: () => {},
      stroke: () => operations.push("stroke"),
      fillText: (text: string, x: number, y: number) => operations.push(`text ${text} ${x} ${y}`),
      createPattern: (source: object) => {
        patternSource = source
        operations.push(source === base ? "original pattern" : "pixelated pattern")
        return {} as CanvasPattern
      },
    } as unknown as CanvasRenderingContext2D
    drawAnnotations(
      context,
      [
        {
          type: "mosaic",
          points: [
            { x: 20, y: 30 },
            { x: 40, y: 50 },
          ],
        },
        { type: "eraser", points: [{ x: 30, y: 40 }] },
        { type: "text", at: { x: 25, y: 35 }, text: "测试" },
      ],
      2,
      2,
      { x: 10, y: 20, width: 100, height: 100 },
      base,
    )
    assert.ok(pixelated)
    assert.equal(patternSource, base)
    assert.deepEqual(
      operations.filter((operation) => operation.includes("pattern")),
      ["pixelated pattern", "original pattern"],
    )
    assert.ok(operations.includes("smoothing false"))
    assert.ok(operations.includes("move 20 20"))
    assert.ok(operations.includes("text 测试 30 30"))
  } finally {
    globalThis.document = previousDocument
  }
})

test("窗口悬停优先命中最上层窗口，空白区域不命中", () => {
  const top = { x: 20, y: 20, width: 60, height: 60 }
  const behind = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(windowAtPoint([top, behind], { x: 30, y: 30 }), top)
  assert.equal(windowAtPoint([top, behind], { x: 90, y: 90 }), behind)
  assert.equal(windowAtPoint([top, behind], { x: 110, y: 30 }), null)
})
