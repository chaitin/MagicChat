import type { DesktopMessage } from "./account-data"

export const MESSAGE_PAGE_SIZE = 20

export type MessageGap = { afterSeq: number; beforeSeq: number; unavailable?: boolean }

export function mergeLocalMessageWindows(older: DesktopMessage[], newer: DesktopMessage[]) {
  const byId = new Map([...older, ...newer].map((message) => [message.id, message]))
  const messages = [...byId.values()].sort(
    (left, right) =>
      left.seq - right.seq ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
  const olderLast = older.filter((message) => !message.virtualType && message.seq > 0).at(-1)
  const newerFirst = newer.find((message) => !message.virtualType && message.seq > 0)
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
  const between = loaded.filter((message) => message.seq < gap.beforeSeq)
  const lastSeq = between.at(-1)?.seq ?? gap.afterSeq
  if (loaded.some((message) => message.seq >= gap.beforeSeq) || between.length === 0) {
    return lastSeq + 1 < gap.beforeSeq
      ? { afterSeq: lastSeq, beforeSeq: gap.beforeSeq, unavailable: true }
      : null
  }
  return { afterSeq: lastSeq, beforeSeq: gap.beforeSeq }
}

export function contiguousMessageSuffix(messages: DesktopMessage[]) {
  if (messages.length < 2) return messages
  let start = messages.length - 1
  while (start > 0 && messages[start - 1].seq + 1 === messages[start].seq) start -= 1
  return messages.slice(start)
}

export function isCompleteLocalPage(messages: DesktopMessage[], beforeSeq: number) {
  if (messages.length === 0 || messages.at(-1)?.seq !== beforeSeq - 1) return false
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index - 1].seq + 1 !== messages[index].seq) return false
  }
  return messages.length === MESSAGE_PAGE_SIZE || messages[0].seq === 1
}
