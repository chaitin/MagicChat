import assert from "node:assert/strict"
import test from "node:test"
import {
  moveSelection,
  normalizeSelection,
  resizeSelection,
  toolbarPosition,
  translateAnnotations,
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

test("缩放左上边时，标注保持在原屏幕坐标", () => {
  const annotations = [
    { type: "rectangle" as const, from: { x: 20, y: 25 }, to: { x: 60, y: 80 } },
    { type: "mosaic" as const, points: [{ x: 40, y: 50 }] },
  ]
  assert.deepEqual(translateAnnotations(annotations, { x: 10, y: -5 }), [
    { type: "rectangle", from: { x: 10, y: 30 }, to: { x: 50, y: 85 } },
    { type: "mosaic", points: [{ x: 30, y: 55 }] },
  ])
})

test("窗口悬停优先命中最上层窗口，空白区域不命中", () => {
  const top = { x: 20, y: 20, width: 60, height: 60 }
  const behind = { x: 0, y: 0, width: 100, height: 100 }
  assert.equal(windowAtPoint([top, behind], { x: 30, y: 30 }), top)
  assert.equal(windowAtPoint([top, behind], { x: 90, y: 90 }), behind)
  assert.equal(windowAtPoint([top, behind], { x: 110, y: 30 }), null)
})
