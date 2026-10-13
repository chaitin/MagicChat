import assert from "node:assert/strict"
import test from "node:test"
import { ACCOUNT_DATA_CHANNELS } from "../src/shared/account-data.ts"
import {
  assertTaskWindowAccountRequest,
  parseTaskWindowOpenInput,
} from "../src/main/task-window-policy.ts"

const base = { targetId: "account-1", projectId: "project-1" }

test("任务窗口允许当前账号用户头像读取和重试，拒绝跨账号与其他实体头像", () => {
  const context = parseTaskWindowOpenInput(base)
  for (const channel of [ACCOUNT_DATA_CHANNELS.getAvatar, ACCOUNT_DATA_CHANNELS.invalidateAvatar]) {
    assert.doesNotThrow(() =>
      assertTaskWindowAccountRequest(context, channel, {
        targetId: base.targetId,
        type: "user",
        id: "u1",
        theme: "light",
      }),
    )
    for (const input of [
      { targetId: "other", type: "user", id: "u1" },
      { targetId: base.targetId, type: "group", id: "group-1" },
      { targetId: base.targetId, type: "user", id: "" },
    ]) {
      assert.throws(() => assertTaskWindowAccountRequest(context, channel, input))
    }
  }
})

test("创建窗口与多个详情窗口各有独立的任务上下文", () => {
  assert.deepEqual(parseTaskWindowOpenInput(base), { ...base, taskId: null })
  assert.deepEqual(parseTaskWindowOpenInput({ ...base, taskId: "task-1" }), {
    ...base,
    taskId: "task-1",
  })
  assert.deepEqual(parseTaskWindowOpenInput({ ...base, taskId: "task-2" }), {
    ...base,
    taskId: "task-2",
  })
  for (const input of [null, { ...base, taskId: "" }, { targetId: "", projectId: "project-1" }]) {
    assert.throws(() => parseTaskWindowOpenInput(input))
  }
})

test("任务窗口只能访问当前账号项目及自身允许的操作", () => {
  const detail = parseTaskWindowOpenInput({ ...base, taskId: "task-1" })
  const create = parseTaskWindowOpenInput(base)
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(detail, ACCOUNT_DATA_CHANNELS.getProjectTask, {
      ...base,
      taskId: "task-1",
    }),
  )
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(create, ACCOUNT_DATA_CHANNELS.createProjectTask, base),
  )
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(detail, ACCOUNT_DATA_CHANNELS.listProjectMembers, base),
  )
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(create, ACCOUNT_DATA_CHANNELS.listProjectTaskAssignees, base),
  )
  for (const [context, channel, input] of [
    [detail, ACCOUNT_DATA_CHANNELS.getProjectTask, { ...base, taskId: "task-2" }],
    [detail, ACCOUNT_DATA_CHANNELS.updateProjectTask, { ...base, taskId: "task-2" }],
    [detail, ACCOUNT_DATA_CHANNELS.createProjectTask, base],
    [create, ACCOUNT_DATA_CHANNELS.deleteProjectTask, { ...base, taskId: "task-1" }],
    [create, ACCOUNT_DATA_CHANNELS.listProjectMembers, { ...base, projectId: "project-2" }],
    [create, ACCOUNT_DATA_CHANNELS.resolveUserNames, { targetId: "other", userIds: ["u1"] }],
    [create, ACCOUNT_DATA_CHANNELS.listConversations, { ...base }],
    [
      create,
      ACCOUNT_DATA_CHANNELS.listProjectTaskAssignees,
      { ...base, projectId: "other-project" },
    ],
    [
      create,
      ACCOUNT_DATA_CHANNELS.listProjectTaskAssignees,
      { ...base, targetId: "other-account" },
    ],
  ] as const) {
    assert.throws(() => assertTaskWindowAccountRequest(context, channel, input))
  }
})
