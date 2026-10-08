import assert from "node:assert/strict"
import test from "node:test"
import { createUnreadAttention } from "../src/main/unread-attention.ts"

test("未读时持续交替显示托盘图，已读后恢复并停止计时", () => {
  const images: boolean[] = []
  const taskbar: boolean[] = []
  let tick: (() => void) | null = null
  let stopped = 0
  const attention = createUnreadAttention({
    showDimmed: (dimmed) => images.push(dimmed),
    setTaskbarAttention: (enabled) => taskbar.push(enabled),
    startTimer(callback, intervalMs) {
      assert.equal(intervalMs, 500)
      tick = callback
      return 1 as unknown as ReturnType<typeof setInterval>
    },
    stopTimer() {
      tick = null
      stopped += 1
    },
  })

  attention.setWindowFocused(true)
  attention.setUnread(true)
  assert.deepEqual(taskbar, [false, false])
  assert.ok(tick)
  const firstTick = tick as (() => void) | null
  firstTick?.()
  firstTick?.()
  assert.deepEqual(images, [true, false])

  attention.setUnread(true)
  attention.setWindowFocused(false)
  assert.equal(taskbar.at(-1), true)
  attention.setWindowFocused(true)
  assert.equal(taskbar.at(-1), false)
  attention.setUnread(false)
  assert.deepEqual(images, [true, false, false])
  assert.equal(stopped, 1)
  assert.equal(tick, null)
  assert.equal(taskbar.at(-1), false)
  attention.setUnread(false)
  assert.equal(stopped, 1)
})

test("窗口外仍有未读时任务栏请求注意，退出时恢复原图", () => {
  const images: boolean[] = []
  const taskbar: boolean[] = []
  let stopped = 0
  const attention = createUnreadAttention({
    showDimmed: (dimmed) => images.push(dimmed),
    setTaskbarAttention: (enabled) => taskbar.push(enabled),
    startTimer: () => 1 as unknown as ReturnType<typeof setInterval>,
    stopTimer: () => {
      stopped += 1
    },
  })

  attention.setUnread(true)
  assert.deepEqual(taskbar, [true])
  attention.close()
  assert.deepEqual(images, [false])
  assert.deepEqual(taskbar, [true, false])
  assert.equal(stopped, 1)
})
