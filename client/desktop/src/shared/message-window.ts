import type { DesktopMessage } from "./account-data"

export const MESSAGE_PAGE_SIZE = 20
export const MAX_VISIBLE_MESSAGES = 200

export type MessageGap = { afterSeq: number; beforeSeq: number; unavailable?: boolean }

export function isConfirmedMessage(message: DesktopMessage) {
  return !message.virtualType && !message.deliveryStatus && message.seq > 0
}

export function mergeLocalMessageWindows(older: DesktopMessage[], newer: DesktopMessage[]) {
  const byId = new Map<string, DesktopMessage>()
  const idByRequest = new Map<string, string>()
  for (const message of [...older, ...newer]) {
    const requestKey =
      message.clientMessageId && !message.virtualType
        ? JSON.stringify([
            message.conversationId,
            message.senderType,
            message.senderId,
            message.clientMessageId,
          ])
        : undefined
    const previousId = requestKey ? idByRequest.get(requestKey) : undefined
    const previous = byId.get(previousId ?? message.id)
    // HTTP and realtime responses can arrive in either order; confirmation must win.
    if (previous && !previous.deliveryStatus && message.deliveryStatus) continue
    if (previousId && previousId !== message.id) byId.delete(previousId)
    byId.set(message.id, message)
    if (requestKey) idByRequest.set(requestKey, message.id)
  }
  const messages = [...byId.values()].sort(
    (left, right) =>
      left.seq - right.seq ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
  const olderLast = older.filter(isConfirmedMessage).at(-1)
  const newerFirst = newer.find(isConfirmedMessage)
  const gap: MessageGap | null =
    olderLast && newerFirst && olderLast.seq + 1 < newerFirst.seq
      ? { afterSeq: olderLast.seq, beforeSeq: newerFirst.seq }
      : null
  return { messages, gap }
}

export function advanceLocalMessageGap(
  gap: MessageGap,
  loaded: DesktopMessage[],
): MessageGap | null {
  const confirmed = loaded.filter(isConfirmedMessage)
  const between = confirmed.filter((message) => message.seq < gap.beforeSeq)
  const lastSeq = between.at(-1)?.seq ?? gap.afterSeq
  if (confirmed.some((message) => message.seq >= gap.beforeSeq) || between.length === 0) {
    return lastSeq + 1 < gap.beforeSeq
      ? { afterSeq: lastSeq, beforeSeq: gap.beforeSeq, unavailable: true }
      : null
  }
  return { afterSeq: lastSeq, beforeSeq: gap.beforeSeq }
}

export function contiguousMessageSuffix(messages: DesktopMessage[]) {
  // Unconfirmed sequence numbers are local estimates, not part of server history.
  const confirmed = messages.filter(isConfirmedMessage)
  if (confirmed.length < 2) return messages
  let start = confirmed.length - 1
  while (start > 0 && confirmed[start - 1].seq + 1 === confirmed[start].seq) start -= 1
  const ids = new Set(confirmed.slice(start).map((message) => message.id))
  return messages.filter((message) => !isConfirmedMessage(message) || ids.has(message.id))
}

export function isCompleteLocalPage(messages: DesktopMessage[], beforeSeq: number) {
  const confirmed = messages.filter(isConfirmedMessage)
  if (confirmed.length === 0 || confirmed.at(-1)?.seq !== beforeSeq - 1) return false
  for (let index = 1; index < confirmed.length; index += 1) {
    if (confirmed[index - 1].seq + 1 !== confirmed[index].seq) return false
  }
  return confirmed.length === MESSAGE_PAGE_SIZE || confirmed[0].seq === 1
}
