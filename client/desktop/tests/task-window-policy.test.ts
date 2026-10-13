import assert from "node:assert/strict"
import test from "node:test"
import { ACCOUNT_DATA_CHANNELS } from "../src/shared/account-data.ts"
import {
  assertTaskWindowAccountRequest,
  parseTaskWindowOpenInput,
} from "../src/main/task-window-policy.ts"

const base = { targetId: "account-1", projectId: "project-1" }

test("任务窗口只能发送当前任务对象卡片，不能借机发送其他富消息", () => {
  const detail = parseTaskWindowOpenInput({ ...base, taskId: "task-1" })
  const channel = ACCOUNT_DATA_CHANNELS.sendRichMessage
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(detail, channel, {
      targetId: base.targetId,
      conversationId: "conversation-1",
      body: { type: "entity_card", entityType: "task", entityId: "task-1" },
    }),
  )
  for (const body of [
    { type: "entity_card", entityType: "task", entityId: "task-2" },
    { type: "entity_card", entityType: "user", entityId: "task-1" },
    { type: "choice", content: "可以吗" },
  ])
    assert.throws(() =>
      assertTaskWindowAccountRequest(detail, channel, {
        targetId: base.targetId,
        conversationId: "conversation-1",
        body,
      }),
    )
})

test("任务窗口允许当前账号联系人目录和用户私聊，拒绝跨账号和群组操作", () => {
  const context = parseTaskWindowOpenInput({ ...base, taskId: "task-1" })
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.getContacts, base.targetId),
  )
  assert.throws(() =>
    assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.getContacts, "other"),
  )
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.openContactConversation, {
      targetId: base.targetId,
      type: "user",
      id: "u1",
    }),
  )
  for (const input of [
    { targetId: "other", type: "user", id: "u1" },
    { targetId: base.targetId, type: "group", id: "g1" },
    { targetId: base.targetId, type: "app", id: "a1" },
    { targetId: base.targetId, type: "user", id: "" },
  ])
    assert.throws(() =>
      assertTaskWindowAccountRequest(context, ACCOUNT_DATA_CHANNELS.openContactConversation, input),
    )
})

test("任务图片上传和读取绑定当前账号、项目和任务，创建窗口不能冒用详情上下文", () => {
  const create = parseTaskWindowOpenInput(base)
  const detail = parseTaskWindowOpenInput({ ...base, taskId: "task-1" })
  for (const channel of [
    ACCOUNT_DATA_CHANNELS.uploadProjectTaskImage,
    ACCOUNT_DATA_CHANNELS.readProjectTaskImage,
  ]) {
    assert.doesNotThrow(() => assertTaskWindowAccountRequest(create, channel, base))
    assert.doesNotThrow(() =>
      assertTaskWindowAccountRequest(detail, channel, { ...base, taskId: "task-1" }),
    )
    for (const [context, input] of [
      [detail, base],
      [detail, { ...base, taskId: "task-2" }],
      [create, { ...base, taskId: "task-1" }],
      [create, { ...base, projectId: "other" }],
      [create, { ...base, targetId: "other" }],
    ] as const)
      assert.throws(() => assertTaskWindowAccountRequest(context, channel, input))
  }
})

test("任务窗口允许会话实体头像读取和重试，拒绝跨账号与无效实体", () => {
  const context = parseTaskWindowOpenInput(base)
  for (const channel of [ACCOUNT_DATA_CHANNELS.getAvatar, ACCOUNT_DATA_CHANNELS.invalidateAvatar]) {
    for (const type of ["user", "group", "topic", "app", "project"] as const) {
      assert.doesNotThrow(() =>
        assertTaskWindowAccountRequest(context, channel, {
          targetId: base.targetId,
          type,
          id: `${type}-1`,
          theme: "light",
        }),
      )
    }
    for (const input of [
      { targetId: "other", type: "user", id: "u1" },
      { targetId: base.targetId, type: "unknown", id: "entity-1" },
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
  assert.doesNotThrow(() =>
    assertTaskWindowAccountRequest(detail, ACCOUNT_DATA_CHANNELS.listConversations, base),
  )
  for (const [context, channel, input] of [
    [detail, ACCOUNT_DATA_CHANNELS.getProjectTask, { ...base, taskId: "task-2" }],
    [detail, ACCOUNT_DATA_CHANNELS.updateProjectTask, { ...base, taskId: "task-2" }],
    [detail, ACCOUNT_DATA_CHANNELS.createProjectTask, base],
    [create, ACCOUNT_DATA_CHANNELS.deleteProjectTask, { ...base, taskId: "task-1" }],
    [create, ACCOUNT_DATA_CHANNELS.listProjectMembers, { ...base, projectId: "project-2" }],
    [create, ACCOUNT_DATA_CHANNELS.resolveUserNames, { targetId: "other", userIds: ["u1"] }],
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
