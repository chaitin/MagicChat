import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(
  new URL("../src/data/messages/message-query-cache.ts", import.meta.url),
  "utf8"
)

test("消息列表预热水合不会压缩聊天页已加载的历史分页", () => {
  const hydration = source.match(
    /export async function hydrateConversationMessagesQuery\([\s\S]*?\n}\n\nexport function compactConversationMessagesQuery/
  )?.[0]

  assert.ok(hydration)
  assert.doesNotMatch(hydration, /compactConversationMessagesData/)
  assert.match(
    hydration,
    /latest\s*\? replaceLatestConversationPage\(latest, page\)/
  )
})

test("只有明确的聊天页清理流程可以压缩历史分页", () => {
  assert.match(
    source,
    /export function compactConversationMessagesQuery[\s\S]*?compactConversationMessagesData/
  )
})
