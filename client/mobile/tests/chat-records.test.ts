import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import type { ClientForwardBundleMessageBody } from "../src/core/models.ts"
import { createChatRecordStore, presentChatRecordMessages } from "../src/features/chat-records/chat-record-model.ts"
import { collectMessageResources, createMessageMentionLabelResolver } from "../src/domain/messages/message-presenter.ts"
import { buildChatRecordHref } from "../src/navigation/chat-records.ts"

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")
function record(): ClientForwardBundleMessageBody {
  return {
    itemCount: 2,
    type: "forward_bundle",
    items: [
      { body: { content: "第一条", type: "text" }, senderName: "Alice", senderType: "user", sentAt: "2026-07-20T10:00:00Z", summary: "第一条" },
      { body: { content: "**第二条**", type: "markdown" }, senderName: "助手", senderType: "app", sentAt: "2026-07-20T09:00:00Z", summary: "第二条" },
    ],
  }
}

test("记录路由只有内存快照ID，不携带消息内容或会话ID", async () => {
  assert.deepEqual(buildChatRecordHref("record-1"), { pathname: "/chat-records/[recordId]", params: { recordId: "record-1" } })
  assert.match(await source("app/(app)/chat-records/[recordId].tsx"), /ChatRecordScreen as default/)
  const layout = await source("app/(app)/_layout.tsx")
  assert.match(layout, /Stack\.Screen name="chat-records\/\[recordId\]"/)
  assert.match(layout, /ChatRecordProvider scopeKey=\{JSON\.stringify\(\[session\?\.id, session\?\.url, session\?\.userId, generation\]\)\}/)
})

test("快照独立于源消息更新，未知或已关闭的ID不暴露数据", () => {
  const store = createChatRecordStore("account-a")
  const body = record()
  const id = store.add(body)
  body.items[0].body = { content: "已修改", type: "text" }
  body.items.pop()
  assert.equal(store.get(id)?.items.length, 2)
  assert.deepEqual(store.get(id)?.items[0].body, { content: "第一条", type: "text" })
  assert.equal(store.get("missing"), null)
  store.remove(id)
  assert.equal(store.get(id), null)
})

test("账号作用域的内存记录互不访问，ID不重用", () => {
  const a = createChatRecordStore("account-a")
  const b = createChatRecordStore("account-b")
  const idA = a.add(record())
  const idB = b.add(record())
  assert.notEqual(idA, idB)
  assert.equal(a.get(idB), null)
  assert.equal(b.get(idA), null)
  assert.equal(a.scopeKey, "account-a")
  assert.equal(b.scopeKey, "account-b")
})

test("打开嵌套记录不会释放父记录，返回后数据和身份稳定", async () => {
  const store = createChatRecordStore("account-a")
  const child = record()
  const parent = record()
  parent.items[1].body = child
  const parentId = store.add(parent)
  const releaseParent = store.retain(parentId)
  const parentSnapshot = store.get(parentId)!
  const parentRows = presentChatRecordMessages(parentSnapshot, parentId)
  const childId = store.add(parentSnapshot.items[1].body as ClientForwardBundleMessageBody)
  const releaseChild = store.retain(childId)
  releaseChild()
  await Promise.resolve()
  assert.equal(store.get(childId), null)
  assert.equal(store.get(parentId), parentSnapshot)
  assert.deepEqual(presentChatRecordMessages(parentSnapshot, parentId), parentRows)
  releaseParent()
  await Promise.resolve()
  assert.equal(store.get(parentId), null)
})

test("StrictMode清理后立即再次挂载不会删除记录，最终释放幂等", async () => {
  const store = createChatRecordStore("account-a")
  const id = store.add(record())
  const cleanup = store.retain(id)
  cleanup()
  cleanup()
  const nextCleanup = store.retain(id)
  await Promise.resolve()
  assert.ok(store.get(id))
  nextCleanup()
  await Promise.resolve()
  assert.equal(store.get(id), null)
})

test("记录按原始顺序呈现，不推断自己发言、头像和原始实体ID", () => {
  const body = record()
  const items = presentChatRecordMessages(body, "record-1")
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((item) => item.message.author), ["Alice", "助手"])
  assert.deepEqual(items.map((item) => item.senderType), ["user", "app"])
  assert.deepEqual(items.map((item) => item.message.createdAt), body.items.map((item) => item.sentAt))
  assert.deepEqual(items.map((item) => item.message.id), ["record-1:0", "record-1:1"])
  for (const [index, item] of items.entries()) {
    assert.equal(item.message.body, body.items[index].body)
    assert.equal(item.message.role, "other")
    assert.equal(item.message.sender, null)
    assert.equal(item.message.avatar, "")
    assert.equal(item.message.canRevoke, false)
    assert.deepEqual(item.message.reactions, [])
  }
})

test("资源按当前详情层收集，嵌套页的媒体独立收集并按fileId去重", () => {
  const body = record()
  body.items[0].body = { fileId: "image-1", type: "image" }
  const nested = record()
  nested.items[0].body = { fileId: "image-1", type: "image" }
  nested.items[1].body = { contentType: "audio/webm", durationMS: 1200, fileId: "voice-1", sizeBytes: 100, transcript: "语音", type: "voice" }
  nested.items.push({ ...nested.items[0] })
  nested.itemCount = 3
  body.items[1].body = nested
  const parentResources = collectMessageResources(presentChatRecordMessages(body, "record-1").map((item) => item.message))
  assert.deepEqual(parentResources.map((item) => item.fileId), ["image-1"])
  const childResources = collectMessageResources(presentChatRecordMessages(nested, "record-2").map((item) => item.message))
  assert.deepEqual(childResources.map((item) => item.fileId), ["image-1", "voice-1"])
  assert.deepEqual(childResources.map((item) => item.kind), ["image", "voice"])
})

test("没有实时会话和当前用户时仍可解析记录中的联系人提及", () => {
  const resolve = createMessageMentionLabelResolver({ contacts: { apps: [], groups: [], users: [] } })
  assert.equal(resolve({ type: "all", id: "all" }), "所有人")
  assert.equal(resolve({ type: "user", id: "unknown" }), undefined)
})

test("合并气泡点击打开记录，长按不误打开且具有按钮语义", async () => {
  const body = await source("features/conversation/messages/message-body.tsx")
  const forward = body.split("function ForwardBundleBody(")[1].split("function getImageDisplaySize(")[0]
  assert.match(forward, /const openRecord = useOpenChatRecord\(\)/)
  assert.match(forward, /accessibilityRole="button"/)
  assert.match(forward, /onLongPress=\{\(\) => \{ didLongPressRef\.current = true; onLongPress\(\)/)
  assert.match(forward, /if \(didLongPressRef\.current\)[\s\S]*?return[\s\S]*?openRecord\(body\)/)
  const navigation = await source("features/chat-records/chat-record-provider.tsx")
  assert.match(navigation, /if \(!focused \|\| openingRef\.current\) return/)
  assert.match(navigation, /store\.add\(body\)[\s\S]*?router\.push\(buildChatRecordHref\(id\)\)/)
  assert.match(navigation, /store\.remove\(id\)/)
  assert.match(navigation, /createChatRecordStore\(scopeKey\)/)
})

test("只读页复用气泡，无输入框、会话请求、已读、回复发送撤回或反应操作", async () => {
  const screen = await source("features/chat-records/chat-record-screen.tsx")
  assert.match(screen, /<AppHeader onBackPress=\{goBack\} title="聊天记录"/)
  assert.match(screen, /<FlatList[\s\S]*?data=\{items\}/)
  assert.match(screen, /<MessageBubble[\s\S]*?avatarType=\{item\.senderType\}/)
  for (const prop of ["canAddReaction", "canCreateTopic", "canRespondToChoice", "messageActionsEnabled"]) assert.ok(screen.includes(`${prop}={false}`))
  assert.doesNotMatch(screen, /MessageComposer|useConversationMessages|useMarkConversationRead|activateConversation|useMessageSelectionActions|useConversationMessageActions|onReply=|onRevoke=|onRespondChoice=|onSetReaction=|\binverted\b|scrollToEnd/)
  assert.match(screen, /useEffect\(\(\) => store\.retain\(recordId\)/)
  assert.match(screen, /聊天记录已失效，请返回后重新打开。/)
  assert.match(screen, /ListEmptyComponent=.*暂无聊天记录/)
  assert.match(screen, /copyTarget && record/)
  assert.doesNotMatch(screen, /formatMessageTimeMarker|item\.message\.createdAt/)
})

test("资源交互无真实会话图库查询，保留复制和语音文件资源功能", async () => {
  const screen = await source("features/chat-records/chat-record-screen.tsx")
  assert.match(screen, /buildAttachmentImagePreviewHref\(fileId\)/)
  assert.doesNotMatch(screen, /buildAttachmentImagePreviewHref\(fileId,/)
  assert.match(screen, /useMessageResources\(session, references\)/)
  assert.match(screen, /openResourceExternally\(await ensure\(fileId\)\)/)
  assert.match(screen, /onVoiceResourcePress=\{\(fileId\) => void prepareVoice\(fileId\)\}/)
  assert.match(screen, /onResourceError=.*reload\(fileId\)/)
  assert.match(screen, /Clipboard\.setStringAsync\(formatClientMessageBodySummary/)
  assert.match(screen, /actions=\{\[\{ label: "复制"/)
})
