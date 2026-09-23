import assert from "node:assert/strict"
import test from "node:test"
import { centerWindowWithinWorkArea } from "../src/main/window-position.ts"

test("预览窗口中心与主窗口中心一致", () => {
  assert.deepEqual(
    centerWindowWithinWorkArea(
      { x: 100, y: 80, width: 1200, height: 900 },
      { x: 0, y: 0, width: 1920, height: 1040 },
      { width: 960, height: 720 },
    ),
    { x: 220, y: 170, width: 960, height: 720 },
  )
})

test("预览窗口位置限制在主窗口所在屏幕的工作区", () => {
  assert.deepEqual(
    centerWindowWithinWorkArea(
      { x: 1700, y: 700, width: 900, height: 700 },
      { x: 0, y: 0, width: 1920, height: 1040 },
      { width: 960, height: 720 },
    ),
    { x: 960, y: 320, width: 960, height: 720 },
  )
})

test("工作区较小时缩小预览窗口并保持在屏幕内", () => {
  assert.deepEqual(
    centerWindowWithinWorkArea(
      { x: -1280, y: 0, width: 1280, height: 720 },
      { x: -1280, y: 0, width: 800, height: 600 },
      { width: 960, height: 720 },
    ),
    { x: -1280, y: 0, width: 800, height: 600 },
  )
})
