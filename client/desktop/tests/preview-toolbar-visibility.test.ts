import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import {
  PreviewToolbarVisibility,
  type PreviewToolbarHold,
} from "../src/renderer/features/media-preview/preview-toolbar-visibility.ts"

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let visible = true
  const changes: boolean[] = []
  const toolbar = new PreviewToolbarVisibility((value) => {
    visible = value
    changes.push(value)
  })
  toolbar.activity()
  t.after(() => toolbar.dispose())
  return { toolbar, changes, visible: () => visible, tick: (ms: number) => t.mock.timers.tick(ms) }
}

test("图片和视频共用的悬浮操作栏在静止3秒后隐藏，移动立即恢复并重新计时", (t) => {
  const f = fixture(t)
  f.tick(2999)
  assert.equal(f.visible(), true)
  f.tick(1)
  assert.equal(f.visible(), false)
  f.toolbar.activity()
  assert.equal(f.visible(), true)
  f.tick(2000)
  f.toolbar.activity()
  f.tick(2999)
  assert.equal(f.visible(), true)
  f.tick(1)
  assert.equal(f.visible(), false)
})

test("离开窗口立即隐藏，不受此前的延迟任务影响", (t) => {
  const f = fixture(t)
  f.tick(1000)
  f.toolbar.leave()
  assert.equal(f.visible(), false)
  f.tick(5000)
  assert.deepEqual(f.changes, [false])
  f.toolbar.activity()
  assert.equal(f.visible(), true)
  f.tick(3000)
  assert.equal(f.visible(), false)
})

test("悬停操作栏、键盘操作、拖动和菜单打开时都保持显示", (t) => {
  const f = fixture(t)
  const holds: PreviewToolbarHold[] = [
    "hover",
    "focus",
    "drag",
    "context-menu",
    "speed-menu",
    "busy",
  ]
  for (const hold of holds) {
    f.toolbar.activity()
    f.toolbar.hold(hold, true)
    f.tick(10_000)
    assert.equal(f.visible(), true, hold)
    f.toolbar.hold(hold, false)
    f.tick(2999)
    assert.equal(f.visible(), true, hold)
    f.tick(1)
    assert.equal(f.visible(), false, hold)
  }
})

test("多个交互保护同时存在时，必须全部结束才重新计时", (t) => {
  const f = fixture(t)
  f.toolbar.hold("hover", true)
  f.toolbar.hold("speed-menu", true)
  f.toolbar.hold("drag", true)
  f.toolbar.hold("hover", false)
  f.toolbar.hold("drag", false)
  f.tick(10_000)
  assert.equal(f.visible(), true)
  f.toolbar.hold("speed-menu", false)
  f.tick(3000)
  assert.equal(f.visible(), false)
})

test("拖出操作栏或进入Portal菜单时保持显示，窗口外结束交互立即隐藏", (t) => {
  const f = fixture(t)
  f.toolbar.hold("drag", true)
  f.toolbar.leave()
  f.tick(10_000)
  assert.equal(f.visible(), true)
  f.toolbar.hold("drag", false)
  assert.equal(f.visible(), false)
  f.toolbar.activity()
  f.toolbar.hold("context-menu", true)
  f.toolbar.leave()
  f.tick(10_000)
  assert.equal(f.visible(), true)
  f.toolbar.hold("context-menu", false)
  assert.equal(f.visible(), false)
})

test("窗口失焦立即隐藏，异步操作完成不重新显示；再次活动才恢复", (t) => {
  const f = fixture(t)
  f.toolbar.hold("busy", true)
  f.toolbar.blur()
  assert.equal(f.visible(), false)
  f.toolbar.hold("busy", false)
  f.tick(10_000)
  assert.equal(f.visible(), false)
  f.toolbar.activity()
  assert.equal(f.visible(), true)
  f.tick(3000)
  assert.equal(f.visible(), false)
})

test("关闭或更换预览后取消计时，迟到的操作回调不再更新界面", (t) => {
  const f = fixture(t)
  f.toolbar.dispose()
  f.tick(10_000)
  f.toolbar.hold("busy", false)
  f.toolbar.activity()
  f.toolbar.leave()
  f.toolbar.blur()
  assert.deepEqual(f.changes, [])
})
