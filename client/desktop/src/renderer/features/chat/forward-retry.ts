import type { ForwardMessagesResult } from "../../../shared/account-data"

export function collectForwardResults(
  result: ForwardMessagesResult,
  previouslySent: ReadonlySet<string>,
) {
  const sent = new Set(previouslySent)
  const failed = new Map<string, string>()
  for (const item of result.results) {
    if (item.status === "sent") sent.add(item.conversationId)
    else failed.set(item.conversationId, item.error?.message ?? "转发失败")
  }
  return { sent, failed, retryIds: [...failed.keys()] }
}
