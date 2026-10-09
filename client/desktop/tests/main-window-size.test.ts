import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import {
  DEFAULT_MAIN_WINDOW_SIZE,
  isMainWindowSize,
  MainWindowSizeStore,
} from "../src/main/main-window-size.ts"
import { centerWindowWithinWorkArea } from "../src/main/window-position.ts"

test("主窗口仅保存尺寸，首次及损坏状态使用默认大小", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "main-window-size-"))
  try {
    const store = new MainWindowSizeStore(directory)
    assert.deepEqual(store.load(), DEFAULT_MAIN_WINDOW_SIZE)
    store.save({ width: 1240, height: 810 })
    const filePath = path.join(directory, "main-window-state.json")
    assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), { width: 1240, height: 810 })
    assert.deepEqual(store.load(), { width: 1240, height: 810 })
    writeFileSync(filePath, JSON.stringify({ width: 1240, height: 810, x: 500, y: 200 }))
    assert.deepEqual(store.load(), { width: 1240, height: 810 })
    writeFileSync(filePath, "not json")
    assert.deepEqual(store.load(), DEFAULT_MAIN_WINDOW_SIZE)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("拒绝越界或非整数的窗口大小，不覆盖已存尺寸", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "main-window-size-"))
  try {
    const store = new MainWindowSizeStore(directory)
    store.save({ width: 1080, height: 760 })
    for (const invalid of [
      { width: 759, height: 760 },
      { width: 1080, height: 559 },
      { width: 10_001, height: 760 },
      { width: 1080.5, height: 760 },
      { width: Infinity, height: 760 },
      null,
    ]) {
      assert.equal(isMainWindowSize(invalid), false)
      if (invalid && "width" in invalid && "height" in invalid) store.save(invalid)
    }
    assert.deepEqual(store.load(), { width: 1080, height: 760 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("主窗口每次启动在主屏工作区居中，且小屏幕不越界", () => {
  const workArea = { x: -1920, y: 40, width: 1920, height: 1000 }
  assert.deepEqual(centerWindowWithinWorkArea(workArea, workArea, { width: 1240, height: 810 }), {
    x: -1580,
    y: 135,
    width: 1240,
    height: 810,
  })
  const smallArea = { x: 0, y: 0, width: 850, height: 600 }
  assert.deepEqual(centerWindowWithinWorkArea(smallArea, smallArea, { width: 1240, height: 810 }), {
    x: 0,
    y: 0,
    width: 850,
    height: 600,
  })
})
