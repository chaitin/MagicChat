import assert from "node:assert/strict"
import test from "node:test"
import {
  taskPropertyMutation,
  taskPropertyValues,
  type TaskPropertyValues,
} from "../src/renderer/features/projects/task-property-mutation.ts"
import type { DesktopProjectTask } from "../src/shared/account-data.ts"

const values: TaskPropertyValues = {
  status: "todo",
  priority: 2,
  assigneeUserId: "u1",
  startDate: "2026-10-13",
  dueDate: "2026-10-20",
  reminder: { mode: "recurring", frequency: "daily", time: "09:00", timezone: "Asia/Shanghai" },
}

test("查看模式只保存当前修改字段，不能覆盖任务标题、说明或其他字段", () => {
  assert.deepEqual(taskPropertyMutation(values, "status", "in_progress"), { status: "in_progress" })
  assert.deepEqual(taskPropertyMutation(values, "priority", 3), { priority: 3 })
  assert.deepEqual(taskPropertyMutation(values, "assigneeUserId", "u2"), { assigneeUserId: "u2" })
  assert.deepEqual(taskPropertyMutation(values, "startDate", "2026-10-14"), {
    startDate: "2026-10-14",
  })
  assert.deepEqual(taskPropertyMutation(values, "dueDate", "2026-10-21"), { dueDate: "2026-10-21" })
  const reminder = {
    ...values.reminder!,
    mode: "recurring" as const,
    frequency: "daily" as const,
    time: "10:00",
  }
  assert.deepEqual(taskPropertyMutation(values, "reminder", reminder), { reminder })
})

test("相同值不产生请求，清空可选字段发送null而非空字符串", () => {
  for (const key of Object.keys(values) as (keyof TaskPropertyValues)[]) {
    assert.equal(taskPropertyMutation(values, key, values[key]), null)
  }
  for (const key of ["assigneeUserId", "startDate", "dueDate"] as const) {
    assert.deepEqual(taskPropertyMutation(values, key, ""), { [key]: null })
  }
  assert.deepEqual(taskPropertyMutation(values, "reminder", null), { reminder: null })
})

test("开始日期晚于截止日期时不能即时提交", () => {
  assert.throws(
    () => taskPropertyMutation(values, "startDate", "2026-10-21"),
    /开始日期不能晚于截止日期/,
  )
  assert.throws(
    () => taskPropertyMutation(values, "dueDate", "2026-10-12"),
    /开始日期不能晚于截止日期/,
  )
})

test("服务端任务转控件值时排除提醒的状态和调度元信息", () => {
  const task = {
    status: "todo",
    priority: 2,
    assignee: { id: "u1" },
    startDate: "2026-10-13",
    dueDate: "2026-10-20",
    reminder: {
      ...values.reminder,
      state: "scheduled",
      nextTriggerAt: "2026-10-14T01:00:00Z",
      lastProcessedAt: null,
    },
  } as DesktopProjectTask
  assert.deepEqual(taskPropertyValues(task), values)
  assert.deepEqual(
    taskPropertyValues({ ...task, assignee: null, startDate: null, dueDate: null, reminder: null }),
    {
      status: "todo",
      priority: 2,
      assigneeUserId: "",
      startDate: "",
      dueDate: "",
      reminder: null,
    },
  )
  const once = {
    mode: "once" as const,
    at: "2026-10-20T01:00:00Z",
    timezone: "Asia/Shanghai" as const,
  }
  assert.deepEqual(
    taskPropertyValues({
      ...task,
      reminder: { ...once, state: "scheduled", nextTriggerAt: once.at, lastProcessedAt: null },
    }).reminder,
    once,
  )
})
