import assert from "node:assert/strict"
import { test } from "node:test"
import {
  CONTENT_ZOOM_OPTIONS,
  CONTENT_ZOOM_VERSION,
  DEFAULT_CONTENT_ZOOM,
  isContentZoom,
  normalizeContentZoom,
} from "../src/shared/desktop.ts"

test("界面缩放的五个选项与默认 100% 一致", () => {
  assert.deepEqual(CONTENT_ZOOM_OPTIONS, [0.8, 0.9, 1, 1.15, 1.3])
  assert.equal(DEFAULT_CONTENT_ZOOM, 1)
  for (const option of CONTENT_ZOOM_OPTIONS) assert.equal(isContentZoom(option), true)
})

test("不接受任意、旧版或非数值的内容缩放比例", () => {
  for (const value of [
    0,
    0.5,
    0.75,
    1.05,
    1.1,
    1.2,
    1.25,
    1.5,
    2,
    -1,
    NaN,
    Infinity,
    "1.15",
    null,
    {},
  ]) {
    assert.equal(isContentZoom(value), false)
  }
})

test("旧配置中的所有缩放值回退到 100%，仅保留新版配置", () => {
  for (const value of [0.75, 0.8, 0.9, 1, 1.1, 1.15, 1.2, 1.25, 1.3]) {
    assert.equal(normalizeContentZoom(value, undefined), DEFAULT_CONTENT_ZOOM)
    assert.equal(normalizeContentZoom(value, 1), DEFAULT_CONTENT_ZOOM)
  }
  for (const option of CONTENT_ZOOM_OPTIONS) {
    assert.equal(normalizeContentZoom(option, CONTENT_ZOOM_VERSION), option)
  }
  assert.equal(normalizeContentZoom(0.75, CONTENT_ZOOM_VERSION), DEFAULT_CONTENT_ZOOM)
  assert.equal(normalizeContentZoom(1.05, CONTENT_ZOOM_VERSION), DEFAULT_CONTENT_ZOOM)
})
