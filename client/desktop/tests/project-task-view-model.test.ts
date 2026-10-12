import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopProjectTask } from "../src/shared/account-data.ts"
import {
  addDays,
  calendarTasksOnDate,
  daysBetween,
  formatDateKey,
  ganttSpan,
  parseDateKey,
  taskDateRange,
} from "../src/renderer/features/projects/task-view-model.ts"

const task = {
  id: "a",
  startDate: "2026-10-30",
  dueDate: "2026-11-02",
} as DesktopProjectTask

test("跨月任务覆盖完整日历区间和甘特时间跨度", () => {
  assert.deepEqual(taskDateRange(task), {
    start: new Date(2026, 9, 30),
    end: new Date(2026, 10, 2),
  })
  assert.deepEqual(calendarTasksOnDate([task], new Date(2026, 9, 31)), [task])
  assert.deepEqual(calendarTasksOnDate([task], new Date(2026, 10, 3)), [])
  assert.deepEqual(ganttSpan(task, new Date(2026, 9, 29)), { left: 1, width: 4 })
})

test("无日期、倒序日期与非法日期安全回退", () => {
  assert.equal(taskDateRange({ ...task, startDate: null, dueDate: null }), null)
  assert.deepEqual(
    taskDateRange({ ...task, startDate: "2026-11-02", dueDate: "2026-10-30" }),
    taskDateRange(task),
  )
  assert.equal(parseDateKey("2026-02-30"), null)
  assert.equal(ganttSpan({ ...task, startDate: null, dueDate: null }, new Date()), null)
})

test("按日历日计算跨度不受夏令时毫秒差影响", () => {
  const date = new Date(2026, 2, 7)
  assert.equal(daysBetween(addDays(date, 2), date), 2)
  assert.equal(formatDateKey(addDays(date, 2)), "2026-03-09")
})
