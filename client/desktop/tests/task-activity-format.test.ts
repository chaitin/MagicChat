import assert from "node:assert/strict"
import test from "node:test"
import { taskActivityChangeText } from "../src/renderer/features/projects/task-activity-format.ts"

const names = new Map([
  ["u1", "张三"],
  ["u2", "李四"],
])

test("任务动态将字段变更显示为可读的前后值", () => {
  assert.equal(
    taskActivityChangeText({ field: "status", from: "todo", to: "in_progress" }, names),
    "修改了状态：从「待办」改为「进行中」",
  )
  assert.equal(
    taskActivityChangeText({ field: "priority", from: 2, to: 3 }, names),
    "修改了优先级：从「中」改为「高」",
  )
  assert.equal(
    taskActivityChangeText({ field: "assignee", from: "u1", to: "u2" }, names),
    "修改了负责人：从「张三」改为「李四」",
  )
  assert.equal(
    taskActivityChangeText({ field: "start_date", from: null, to: "2026-10-13" }, names),
    "修改了开始日期：从「未设置」改为「2026-10-13」",
  )
  assert.equal(
    taskActivityChangeText({ field: "labels", from: ["旧"], to: ["新", "紧急"] }, names),
    "修改了标签：从「旧」改为「新、紧急」",
  )
  assert.equal(
    taskActivityChangeText({ field: "description", from: null, to: null }, names),
    "修改了详细说明",
  )
})

test("任务提醒变更显示重复规则和北京时间", () => {
  assert.equal(
    taskActivityChangeText(
      {
        field: "reminder",
        from: null,
        to: {
          mode: "recurring",
          frequency: "weekly",
          weekdays: [1, 3],
          time: "09:00",
          timezone: "Asia/Shanghai",
        },
      },
      names,
    ),
    "修改了任务提醒：从「不提醒」改为「每周一、三 09:00（北京时间）」",
  )
})
