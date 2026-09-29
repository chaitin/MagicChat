import assert from "node:assert/strict"
import test from "node:test"
import { projectCapturedScreens, projectWindowsToDisplays } from "../src/main/screenshot-windows.ts"

test("Windows 物理窗口坐标按各屏缩放映射至 Electron 选区坐标", () => {
  const snapshot = {
    Monitors: [
      { X: 0, Y: 0, Width: 3840, Height: 2160 },
      { X: -2560, Y: 0, Width: 2560, Height: 1440 },
    ],
    Windows: [
      { X: -100, Y: 100, Width: 400, Height: 400 },
      { X: 100, Y: 50, Width: 800, Height: 600 },
    ],
  }
  const displays = [
    { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 1, bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
  ]
  const windows = projectWindowsToDisplays(snapshot, displays)
  assert.deepEqual(windows.get(1), [{ x: 1230, y: 50, width: 50, height: 200 }])
  assert.deepEqual(windows.get(2), [
    { x: 0, y: 50, width: 150, height: 200 },
    { x: 50, y: 25, width: 400, height: 300 },
  ])
})

test("系统级双屏 PNG 根据物理屏幕位置匹配而非屏幕来源数量", () => {
  function png(width: number, height: number) {
    const bytes = Buffer.alloc(24)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
    bytes.writeUInt32BE(width, 16)
    bytes.writeUInt32BE(height, 20)
    return bytes.toString("base64")
  }
  const left = { X: -3840, Y: 0, Width: 3840, Height: 2160 }
  const right = { X: 0, Y: 0, Width: 3840, Height: 2160 }
  const displays = [
    { id: 3401554934, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 },
    { id: 3383161997, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 2 },
  ]
  const snapshot = {
    Monitors: [right, left],
    Windows: [],
    Screens: [
      { ...right, Png: png(3840, 2160) },
      { ...left, Png: png(3840, 2160) },
    ],
  }
  const result = projectCapturedScreens(snapshot, displays)
  assert.equal(result.size, 2)
  assert.equal(result.get(3383161997)?.readUInt32BE(16), 3840)
  assert.equal(result.get(3401554934)?.readUInt32BE(20), 2160)
  assert.equal(
    projectCapturedScreens({ ...snapshot, Screens: [snapshot.Screens[0]] }, displays).size,
    0,
  )
  assert.equal(
    projectCapturedScreens(
      { ...snapshot, Screens: [{ ...snapshot.Screens[0], Png: png(10, 10) }, snapshot.Screens[1]] },
      displays,
    ).size,
    0,
  )
})

test("屏幕映射不完整时不提供错误的窗口高亮", () => {
  const snapshot = { Monitors: [], Windows: [{ X: 0, Y: 0, Width: 200, Height: 200 }] }
  assert.equal(
    projectWindowsToDisplays(snapshot, [{ id: 1, bounds: { x: 0, y: 0, width: 500, height: 500 } }])
      .size,
    0,
  )
  assert.equal(
    projectWindowsToDisplays(
      { Monitors: [{ X: 0, Y: 0, Width: 1000, Height: 1000 }], Windows: snapshot.Windows },
      [{ id: 1, bounds: { x: 0, y: 0, width: 500, height: 500 }, scaleFactor: 1.25 }],
    ).size,
    0,
  )
})
