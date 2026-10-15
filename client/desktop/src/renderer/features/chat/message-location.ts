import type { AccountDataBridge, DesktopLocalMessageWindow } from "../../../shared/account-data"
import { MAX_VISIBLE_MESSAGES } from "../../../shared/message-window.ts"

export async function loadMessageLocationContext({
  accountData,
  targetId,
  conversationId,
  messageId,
  beforeSeq,
  isCurrent,
}: {
  accountData: Pick<AccountDataBridge, "getLocalMessageContext" | "loadBeforeMessages">
  targetId: string
  conversationId: string
  messageId: string
  beforeSeq?: number
  isCurrent: () => boolean
}): Promise<DesktopLocalMessageWindow | null> {
  const input = { targetId, conversationId, messageId }
  if (!isCurrent()) return null
  let result = await accountData.getLocalMessageContext(input)
  let cursor = beforeSeq
  while (isCurrent()) {
    if (
      result.ok &&
      result.data.messages.some(
        (message) => message.id === messageId && message.conversationId === conversationId,
      )
    )
      return result.data
    if (!result.ok && result.error.code !== "message_not_found") {
      throw new Error(result.error.message)
    }
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor <= 1) {
      throw new Error("原消息不存在或已不可见")
    }
    const before = cursor
    const page = await accountData.loadBeforeMessages({
      targetId,
      conversationId,
      beforeSeq: before,
      loadedCount: MAX_VISIBLE_MESSAGES,
    })
    if (!isCurrent()) return null
    if (!page.ok) throw new Error(page.error.message)
    result = await accountData.getLocalMessageContext(input)
    if (!isCurrent()) return null
    if (
      result.ok &&
      result.data.messages.some(
        (message) => message.id === messageId && message.conversationId === conversationId,
      )
    )
      return {
        ...result.data,
        hasMoreBefore: result.data.hasMoreBefore || page.data.hasMoreBefore,
      }
    const next = page.data.messages.find(
      (message) =>
        message.conversationId === conversationId && message.seq > 0 && message.seq < before,
    )?.seq
    if (!page.data.hasMoreBefore || next === undefined) {
      throw new Error("原消息不存在或已不可见")
    }
    cursor = next
  }
  return null
}
