import assert from "node:assert/strict"
import { test } from "node:test"
import { CONTENT_ZOOM_OPTIONS, DEFAULT_CONTENT_ZOOM, isContentZoom } from "../src/shared/desktop.ts"

test("界面缩放的三个选项与默认 100% 一致", () => {
  assert.deepEqual(CONTENT_ZOOM_OPTIONS, [0.75, 1, 1.25])
  assert.equal(DEFAULT_CONTENT_ZOOM, 1)
  for (const option of CONTENT_ZOOM_OPTIONS) assert.equal(isContentZoom(option), true)
})

test("不接受任意、非法或非数值的内容缩放比例", () => {
  for (const value of [0, 0.5, 1.1, 1.5, 1.75, 2, -1, NaN, Infinity, "1.5", null, {}]) {
    assert.equal(isContentZoom(value), false)
  }
})
