import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopProjectTask, ProjectMember } from "../src/shared/account-data.ts"
import {
  addDays,
  calendarTasksOnDate,
  daysBetween,
  formatDateKey,
  ganttSpan,
  isValid24HourTime,
  parseDateKey,
  shanghaiReminderDateTime,
  shanghaiReminderISO,
  taskDateRange,
  withResolvedMemberNames,
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

test("成员接口省略姓名时由现有用户解析接口补全，不将 ID 当作姓名", () => {
  const members = [
    { id: "u1", displayName: "u1" },
    { id: "u2", displayName: "已有昵称" },
  ] as ProjectMember[]
  assert.deepEqual(
    withResolvedMemberNames(members, [
      { id: "u1", name: "张三" },
      { id: "u2", name: "其他名称" },
    ]).map((member) => member.displayName),
    ["张三", "其他名称"],
  )
  assert.equal(
    withResolvedMemberNames(members, [{ id: "u1", name: "u1" }])[0]?.displayName,
    "未知成员",
  )
})

test("24 小时制时间只接受 HH:mm 且限制小时分钟范围", () => {
  assert.equal(isValid24HourTime("00:00"), true)
  assert.equal(isValid24HourTime("23:59"), true)
  for (const time of ["24:00", "12:60", "1:30", "12:30 AM", "12:30:00", ""]) {
    assert.equal(isValid24HourTime(time), false)
  }
})

test("提醒日期和时间按北京时间转换，跨 UTC 日不会偏移", () => {
  const at = shanghaiReminderISO("2026-10-20", "00:30")
  assert.equal(at, "2026-10-19T16:30:00.000Z")
  assert.deepEqual(shanghaiReminderDateTime(at), { date: "2026-10-20", time: "00:30" })
  assert.equal(
    shanghaiReminderISO("2026-11-03", shanghaiReminderDateTime(at).time),
    "2026-11-02T16:30:00.000Z",
  )
})

test("按日历日计算跨度不受夏令时毫秒差影响", () => {
  const date = new Date(2026, 2, 7)
  assert.equal(daysBetween(addDays(date, 2), date), 2)
  assert.equal(formatDateKey(addDays(date, 2)), "2026-03-09")
})
