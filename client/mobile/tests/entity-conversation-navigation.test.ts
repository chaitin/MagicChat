import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("资料页在会话进入列表前仍可打开聊天页", async () => {
  const [detail, conversation] = await Promise.all([
    source("src/features/entity-details/entity-detail-screen.tsx"),
    source("src/features/conversation/conversation-screen.tsx"),
  ])

  assert.match(
    detail,
    /conversations\.some\([\s\S]*?conversation\.id === profile\.id[\s\S]*?profile\.joined && hasListedGroupConversation/
  )
  assert.match(
    detail,
    /joined: profile\.type === "group" \? profile\.joined : undefined/
  )
  assert.match(
    conversation,
    /conversationManager\.get\(session, conversationId\)[\s\S]*?setUnlistedConversation\(storedConversation\)/
  )
  assert.match(
    conversation,
    /topicQuery\.data\?\.conversation \?\?[\s\S]*?listedConversation \?\?[\s\S]*?cachedConversation/
  )
  assert.doesNotMatch(
    conversation,
    /if \(isReady && !conversation && !expectsTopic\)[\s\S]*?dismissTo\("\/messages"\)/
  )
})

test("已加入但未显示的群聊通过恢复接口重新打开", async () => {
  const [api, hooks] = await Promise.all([
    source("src/data/conversations/conversations-api.ts"),
    source("src/data/conversations/conversation-hooks.ts"),
  ])

  assert.match(
    api,
    /export async function restoreConversation[\s\S]*?\/restore`[\s\S]*?method: "POST"/
  )
  assert.match(
    hooks,
    /return input\.joined[\s\S]*?restoreConversation\(target, input\.id\)[\s\S]*?joinGroupConversation\(target, input\.id\)/
  )
})
