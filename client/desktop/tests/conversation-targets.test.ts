import assert from "node:assert/strict"
import test from "node:test"
import type {
  AccountDataBridge,
  DesktopContactUser,
  DesktopConversation,
  ForwardMessagesResult,
} from "../src/shared/account-data.ts"
import {
  conversationTargetName,
  filterConversationTargets,
  mergeConversationTargetCandidates,
  resolveConversationTarget,
} from "../src/shared/conversation-targets.ts"
import { forwardToConversationTargets } from "../src/renderer/features/chat/forward-targets.ts"
import { collectForwardResults } from "../src/renderer/features/chat/forward-retry.ts"

const contact = (id: string, name = "张三"): DesktopContactUser => ({
  id,
  name,
  nickname: "",
  avatarType: "user",
  avatarId: id,
  email: `${id}@example.com`,
  phone: "13812345678",
  online: false,
})
const conversation = (id: string, userId?: string): DesktopConversation => ({
  id,
  name: "已有对话",
  type: userId ? "direct" : "group",
  avatarType: userId ? "user" : "group",
  avatarId: userId || id,
  memberCount: userId ? 2 : 3,
  members: userId
    ? [
        { id: "self", type: "user", name: "自己", nickname: "", email: "", phone: "" },
        { id: userId, type: "user", name: "张三", nickname: "", email: "", phone: "" },
      ]
    : [],
  createdAt: "2026-10-13T00:00:00Z",
  lastMessageAt: null,
  lastMessageSummary: "",
  pinned: false,
  notificationMuted: false,
  isBuiltinAssistant: false,
  unreadCount: 0,
})
const bridgeFor = (open: AccountDataBridge["openContactConversation"]) => ({
  openContactConversation: open,
})

test("保留已有对话并补齐全量联系人，按用户ID去重而不是名字", () => {
  const group = conversation("group")
  const candidates = mergeConversationTargetCandidates(
    [conversation("direct", "u1"), group],
    [contact("u1"), contact("u2"), contact("u3"), contact("u3")],
  )
  assert.deepEqual(
    candidates.map((item) => item.key),
    ["contact:u1", "conversation:group", "contact:u2", "contact:u3"],
  )
  assert.deepEqual(
    candidates.map((item) => item.kind),
    ["conversation", "conversation", "contact", "contact"],
  )
  assert.equal(conversationTargetName(candidates[2]!), "张三")
  assert.equal(conversationTargetName(candidates[3]!), "张三")
})

test("私聊成员缺失时按头像身份去重，群聊及应用不吞掉同ID联系人", () => {
  const direct = conversation("direct", "U1")
  delete direct.members
  const app = { ...conversation("app"), type: "app", avatarType: "app" as const, avatarId: "u2" }
  const candidates = mergeConversationTargetCandidates(
    [direct, app],
    [contact("u1"), contact("u2")],
  )
  assert.deepEqual(
    candidates.map((item) => item.key),
    ["contact:u1", "conversation:app", "contact:u2"],
  )
})

test("不可发送的私聊不通过补联系人绕过限制，归档话题不出现在候选", () => {
  const readonly = { ...conversation("direct", "u1"), canSend: false }
  const topic = {
    ...conversation("topic"),
    type: "topic",
    topic: {
      archived: true,
      parentConversationId: "group",
      participating: false,
      sourceSender: { id: "u1", name: "张三", type: "user" as const },
    },
  }
  assert.deepEqual(
    mergeConversationTargetCandidates([readonly, topic], [contact("u1"), contact("u2")]).map(
      (item) => item.key,
    ),
    ["contact:u2"],
  )
})

test("联系人和后来建立的私聊使用相同候选key，部分成功状态不会丢失", () => {
  const before = mergeConversationTargetCandidates([], [contact("u1")])[0]!
  const after = mergeConversationTargetCandidates(
    [conversation("new-direct", "u1")],
    [contact("u1")],
  )[0]!
  assert.equal(before.key, after.key)
})

test("混合候选支持姓名昵称邮箱手机号、全拼和首字母搜索", () => {
  const user = { ...contact("u1", "张三"), nickname: "小张" }
  const candidates = mergeConversationTargetCandidates(
    [{ ...conversation("g1"), name: "研发组" }],
    [user],
  )
  for (const query of ["张三", "小张", "zhangsan", "zs", "u1@example.com", "138-1234"]) {
    assert.equal(filterConversationTargets(candidates, query)[0]?.key, "contact:u1")
  }
  assert.equal(filterConversationTargets(candidates, "yf")[0]?.key, "conversation:g1")
})

test("选择已有对话不创建私聊；联系人发送前打开且重试复用真实对话ID", async () => {
  let opens = 0
  const bridge = bridgeFor(async (input) => {
    opens++
    assert.deepEqual(input, { targetId: "account", type: "user", id: "u1" })
    return { ok: true, data: conversation("new-direct", "u1") }
  })
  const cache = new Map<string, string>()
  const targets = mergeConversationTargetCandidates([conversation("g1")], [contact("u1")])
  assert.equal(await resolveConversationTarget(targets[0]!, "account", bridge, cache), "g1")
  assert.equal(opens, 0)
  assert.equal(await resolveConversationTarget(targets[1]!, "account", bridge, cache), "new-direct")
  assert.equal(await resolveConversationTarget(targets[1]!, "account", bridge, cache), "new-direct")
  assert.equal(opens, 1)
})

test("打开私聊失败或只读不缓存错误结果", async () => {
  const target = mergeConversationTargetCandidates([], [contact("u1")])[0]!
  const cache = new Map<string, string>()
  const failed = bridgeFor(async () => ({
    ok: false,
    error: { code: "forbidden", message: "无法打开私聊" },
  }))
  await assert.rejects(resolveConversationTarget(target, "account", failed, cache), /无法打开私聊/)
  const readonly = bridgeFor(async () => ({
    ok: true,
    data: { ...conversation("direct", "u1"), canSend: false },
  }))
  await assert.rejects(resolveConversationTarget(target, "account", readonly, cache), /不能发送/)
  assert.equal(cache.size, 0)
})

test("混合目标部分打开失败不会阻止其他转发，重试只发送失败联系人", async () => {
  const candidates = mergeConversationTargetCandidates(
    [conversation("group")],
    [contact("u1"), contact("u2")],
  )
  let failOpen = true
  const opened: string[] = []
  const bridge = bridgeFor(async (input) => {
    opened.push(input.id)
    if (input.id === "u2" && failOpen)
      return { ok: false, error: { code: "forbidden", message: "无法打开私聊" } }
    return { ok: true, data: conversation(`direct-${input.id}`, input.id) }
  })
  const batches: string[][] = []
  const forward = async (ids: string[]): Promise<ForwardMessagesResult> => {
    batches.push(ids)
    return {
      sentCount: ids.length,
      failedCount: 0,
      results: ids.map((id) => ({ conversationId: id, status: "sent", messages: [] })),
    }
  }
  const cache = new Map<string, string>()
  const first = await forwardToConversationTargets(candidates, "account", bridge, cache, forward)
  const retry = collectForwardResults(first, new Set())
  assert.deepEqual(batches, [["group", "direct-u1"]])
  assert.deepEqual([...retry.sent], ["conversation:group", "contact:u1"])
  assert.deepEqual(retry.retryIds, ["contact:u2"])
  failOpen = false
  const second = await forwardToConversationTargets(
    candidates.filter((item) => retry.retryIds.includes(item.key)),
    "account",
    bridge,
    cache,
    forward,
  )
  assert.equal(second.failedCount, 0)
  assert.deepEqual(batches, [["group", "direct-u1"], ["direct-u2"]])
  assert.deepEqual(opened, ["u1", "u2", "u2"])
})

test("发送失败后重试不会重新创建已打开的私聊", async () => {
  const candidates = mergeConversationTargetCandidates([], [contact("u1")])
  let opens = 0
  const bridge = bridgeFor(async () => {
    opens++
    return { ok: true, data: conversation("direct", "u1") }
  })
  const cache = new Map<string, string>()
  const first = await forwardToConversationTargets(
    candidates,
    "account",
    bridge,
    cache,
    async () => {
      throw new Error("网络错误")
    },
  )
  assert.equal(first.failedCount, 1)
  const second = await forwardToConversationTargets(
    candidates,
    "account",
    bridge,
    cache,
    async () => ({
      sentCount: 1,
      failedCount: 0,
      results: [{ conversationId: "direct", status: "sent", messages: [] }],
    }),
  )
  assert.equal(second.sentCount, 1)
  assert.equal(opens, 1)
})
