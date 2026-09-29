import assert from "node:assert/strict"
import test from "node:test"
import { validEditedPng, validScreenshotSelection } from "../src/main/screenshot-policy.ts"

const area = { x: 10, y: 20, width: 120, height: 70, viewportWidth: 800, viewportHeight: 600 }

test("选区不能越出当前显示器或含非有限坐标", () => {
  assert.equal(validScreenshotSelection(area), true)
  assert.equal(validScreenshotSelection({ ...area, x: -1 }), false)
  assert.equal(validScreenshotSelection({ ...area, x: 700 }), false)
  assert.equal(validScreenshotSelection({ ...area, width: Number.NaN }), false)
})

test("标注图只接收有限大小的 PNG ArrayBuffer", () => {
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  new DataView(png.buffer).setUint32(8, 13)
  png.set([73, 72, 68, 82], 12)
  assert.equal(validEditedPng(png.buffer), true)
  assert.equal(validEditedPng(png), false)
  assert.equal(validEditedPng(new ArrayBuffer(0)), false)
  assert.equal(validEditedPng(new ArrayBuffer(32 * 1024 * 1024 + 1)), false)
  png[0] = 0
  assert.equal(validEditedPng(png.buffer), false)
})
