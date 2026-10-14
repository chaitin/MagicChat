import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import type { DesktopProjectTask, ProjectMember } from "../src/shared/account-data.ts"
import {
  addDays,
  calendarTasksOnDate,
  daysBetween,
  formatDateKey,
  ganttColumnSpan,
  ganttSpan,
  isGanttColumnCurrent,
  isValid24HourTime,
  mergeTaskLabels,
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

test("甘特日列只高亮本地当天，忽略时分秒且不高亮范围外日期", () => {
  const first = new Date(2026, 9, 14)
  const today = new Date(2026, 9, 16, 23, 59)
  assert.equal(isGanttColumnCurrent(first, today, 2, 1), true)
  assert.equal(isGanttColumnCurrent(first, today, 1, 1), false)
  assert.equal(isGanttColumnCurrent(first, today, 3, 1), false)
  assert.equal(isGanttColumnCurrent(first, new Date(2026, 9, 13), 0, 1), false)
})

test("甘特周列高亮包含今天的一列，周末与下一周期边界不重复", () => {
  const first = new Date(2026, 9, 12)
  assert.equal(isGanttColumnCurrent(first, new Date(2026, 9, 12), 0, 7), true)
  assert.equal(isGanttColumnCurrent(first, new Date(2026, 9, 18, 23, 59), 0, 7), true)
  assert.equal(isGanttColumnCurrent(first, new Date(2026, 9, 19), 0, 7), false)
  assert.equal(isGanttColumnCurrent(first, new Date(2026, 9, 19), 1, 7), true)
})

test("甘特多周合并列跨年仍正确定位当前周期", () => {
  const first = new Date(2026, 11, 28)
  assert.equal(isGanttColumnCurrent(first, new Date(2027, 0, 10), 0, 14), true)
  assert.equal(isGanttColumnCurrent(first, new Date(2027, 0, 11), 0, 14), false)
  assert.equal(isGanttColumnCurrent(first, new Date(2027, 0, 11), 1, 14), true)
})

test("周内单日任务与整周任务都占满同一列", () => {
  const first = new Date(2026, 9, 12)
  for (let offset = 0; offset < 14; offset++) {
    const date = formatDateKey(addDays(first, offset))
    assert.deepEqual(ganttColumnSpan({ ...task, startDate: date, dueDate: date }, first, 7), {
      left: Math.floor(offset / 7),
      width: 1,
    })
  }
  assert.deepEqual(
    ganttColumnSpan({ ...task, startDate: "2026-10-12", dueDate: "2026-10-18" }, first, 7),
    { left: 0, width: 1 },
  )
})

test("跨周任务按整列取整，截止日恰好落在新一周时包含该周", () => {
  const first = new Date(2026, 9, 12)
  assert.deepEqual(
    ganttColumnSpan({ ...task, startDate: "2026-10-14", dueDate: "2026-10-20" }, first, 7),
    { left: 0, width: 2 },
  )
  assert.deepEqual(
    ganttColumnSpan({ ...task, startDate: "2026-10-18", dueDate: "2026-10-19" }, first, 7),
    { left: 0, width: 2 },
  )
  assert.deepEqual(
    ganttColumnSpan({ ...task, startDate: "2026-10-19", dueDate: "2026-10-19" }, first, 7),
    { left: 1, width: 1 },
  )
})

test("最后不完整周期铺满末列，日列和多周列也按同一列宽对齐", () => {
  const first = new Date(2026, 9, 12)
  for (const unitDays of [1, 7, 14]) {
    for (const totalDays of [21, 91, 100, 631]) {
      const date = formatDateKey(addDays(first, totalDays - 1))
      const span = ganttColumnSpan({ ...task, startDate: date, dueDate: date }, first, unitDays)!
      const columns = Math.ceil(totalDays / unitDays)
      assert.equal(span.width, 1)
      assert.equal((span.left + span.width) * 64, columns * 64)
      const whole = ganttColumnSpan(
        { ...task, startDate: formatDateKey(first), dueDate: date },
        first,
        unitDays,
      )!
      assert.deepEqual(whole, { left: 0, width: columns })
    }
  }
  assert.deepEqual(ganttColumnSpan(task, first, 1), ganttSpan(task, first))
  assert.equal(ganttColumnSpan({ ...task, startDate: null, dueDate: null }, first, 7), null)
})

test("甘特表头、网格和任务条使用统一固定列宽，不再叠加百分比刻度", () => {
  const source = readFileSync(
    new URL("../src/renderer/features/projects/project-task-views.tsx", import.meta.url),
    "utf8",
  ).split("export function TaskGanttView(")[1]
  assert.match(source, /const columnWidth = 64/)
  assert.match(source, /const timelineWidth = columns \* columnWidth/)
  assert.match(source, /width: 224 \+ timelineWidth/)
  assert.match(source, /backgroundSize: `\$\{columnWidth\}px 100%`/)
  assert.match(source, /left: span\.left \* columnWidth/)
  assert.match(source, /width: span\.width \* columnWidth/)
  assert.equal(source.match(/backgroundImage:/g)?.length, 1)
  assert.doesNotMatch(source, /unitDays \/ spanDays|span\.left \/ spanDays|span\.width \/ spanDays/)
})

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

test("标签回车和保存合并草稿时去重、清除空白，保留标签顺序和逗号文本", () => {
  const labels = ["发版", "设计"]
  assert.deepEqual(mergeTaskLabels(labels, "  测试  "), ["发版", "设计", "测试"])
  assert.deepEqual(mergeTaskLabels(labels, "  发版  "), labels)
  assert.deepEqual(mergeTaskLabels(labels, "  "), labels)
  assert.deepEqual(mergeTaskLabels(["发版", "发版", "  "], "设计"), labels)
  assert.deepEqual(mergeTaskLabels(labels, "产品,设计"), ["发版", "设计", "产品,设计"])
  assert.deepEqual(labels, ["发版", "设计"])
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
