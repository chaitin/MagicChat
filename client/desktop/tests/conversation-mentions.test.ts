import assert from "node:assert/strict"
import test from "node:test"
import type { DesktopConversation } from "../src/shared/account-data.ts"
import { parseConversationMembers } from "../src/main/account/conversation-members.ts"
import {
  createDraftFromMessage,
  createDraftMentionTemplate,
  createMentionCandidates,
  filterMentionCandidates,
  getMentionTrigger,
  insertDraftMention,
  syncDraftMentions,
} from "../src/renderer/features/chat/conversation-mentions.ts"

const aliceId = "00000000-0000-0000-0000-000000000011"
const appId = "00000000-0000-0000-0000-000000000012"
const members = parseConversationMembers({
  members: [
    { id: aliceId, type: "user", name: "张三", nickname: "阿丽", email: "alice@example.com" },
    { id: appId, type: "app", name: "助手" },
    { id: "invalid", type: "system", name: "系统" },
  ],
})

function group(): DesktopConversation {
  return { id: "group", type: "group", members } as DesktopConversation
}

test("群聊及群话题显示所有人与成员候选，私聊不弹候选", () => {
  const candidates = createMentionCandidates(group(), [group()])
  assert.deepEqual(
    candidates.map(({ label }) => label),
    ["所有人", "阿丽", "助手"],
  )
  assert.deepEqual(
    filterMentionCandidates(candidates, "ali").map(({ label }) => label),
    ["阿丽"],
  )
  assert.deepEqual(
    filterMentionCandidates(candidates, "zl").map(({ label }) => label),
    [],
  )
  const topic = {
    type: "topic",
    topic: { parentConversationId: "group", parentConversationType: "group" },
  } as DesktopConversation
  assert.equal(createMentionCandidates(topic, [group()]).length, 3)
  assert.deepEqual(createMentionCandidates({ type: "direct" } as DesktopConversation, []), [])
})

test("光标附近 @ 触发搜索，空格和二次 @ 结束当前搜索", () => {
  assert.deepEqual(getMentionTrigger("早上 @阿", 5), { start: 3, query: "阿" })
  assert.equal(getMentionTrigger("@张 三", 4), null)
  assert.deepEqual(getMentionTrigger("@张@助", 4), { start: 2, query: "助" })
})

test("候选插入转换为服务端提及模板，改动文字会使提及失效", () => {
  const candidate = createMentionCandidates(group(), [group()])[1]
  const inserted = insertDraftMention("你好 @a 后续", [], candidate, 3, 5)
  assert.equal(inserted.value, "你好 @阿丽  后续")
  assert.equal(
    createDraftMentionTemplate(inserted.value, inserted.mentions),
    `你好 {(@user/${aliceId})}  后续`,
  )
  const shifted = syncDraftMentions(inserted.mentions, inserted.value, `前缀${inserted.value}`)
  assert.equal(
    createDraftMentionTemplate(`前缀${inserted.value}`, shifted),
    `前缀你好 {(@user/${aliceId})}  后续`,
  )
  const changed = inserted.value.replace("阿丽", "别人")
  assert.deepEqual(syncDraftMentions(inserted.mentions, inserted.value, changed), [])
  assert.equal(createDraftMentionTemplate(changed, []), changed)
})

test("所有人及重编辑消息保留提及身份", () => {
  const all = createMentionCandidates(group(), [group()])[0]
  const inserted = insertDraftMention("@", [], all, 0, 1)
  assert.equal(createDraftMentionTemplate(inserted.value, inserted.mentions), "{(@user/all)} ")
  const restored = createDraftFromMessage(`回复 {(@app/${appId})}`, () => "助手")
  assert.equal(restored.text, "回复 @助手")
  assert.equal(
    createDraftMentionTemplate(restored.text, restored.mentions),
    `回复 {(@app/${appId})}`,
  )
})
