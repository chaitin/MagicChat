import type { DesktopMessage } from "../../../shared/account-data"
import {
  MAX_VISIBLE_MESSAGES,
  contiguousMessageSuffix,
  mergeLocalMessageWindows,
  type MessageGap,
} from "../../../shared/message-window.ts"

export { MAX_VISIBLE_MESSAGES }

export function boundMessageWindow(messages: DesktopMessage[], direction: "older" | "newer") {
  if (messages.length <= MAX_VISIBLE_MESSAGES) {
    return { messages, removedBefore: false, removedAfter: false }
  }
  return direction === "older"
    ? {
        messages: messages.slice(0, MAX_VISIBLE_MESSAGES),
        removedBefore: false,
        removedAfter: true,
      }
    : {
        messages: messages.slice(-MAX_VISIBLE_MESSAGES),
        removedBefore: true,
        removedAfter: false,
      }
}

export function hasEarlierMessages(current: DesktopMessage[], next: DesktopMessage[]) {
  const oldest = current.find((message) => !message.virtualType && message.seq > 0)
  return Boolean(
    oldest &&
    next.some((message) => !message.virtualType && message.seq > 0 && message.seq < oldest.seq),
  )
}

export function mergeRefreshedMessages(
  current: DesktopMessage[],
  incoming: DesktopMessage[],
  atBottom: boolean,
) {
  // Incoming records win updates, while already loaded history remains available.
  const merged = mergeLocalMessageWindows(current, incoming).messages
  return boundMessageWindow(merged, atBottom ? "newer" : "older")
}

export function retainMessageWindow(next: DesktopMessage[], current: DesktopMessage[]) {
  if (next.length === 0) return []
  const previous = current.filter((message) => message.conversationId === next[0].conversationId)
  const merged = mergeLocalMessageWindows(previous, next).messages
  const virtualMessages = merged
    .filter((message) => message.virtualType)
    .slice(-MAX_VISIBLE_MESSAGES)
  const visibleCount = Math.min(
    MAX_VISIBLE_MESSAGES - virtualMessages.length,
    Math.max(50, previous.filter((message) => !message.virtualType).length),
  )
  const regular = merged.filter((message) => !message.virtualType)
  // Pending sequence numbers are estimates and can overlap confirmed messages.
  const contiguous = contiguousMessageSuffix(regular.filter((message) => !message.deliveryStatus))
  const confirmedIds = new Set(contiguous.map((message) => message.id))
  const regularMessages = regular.filter(
    (message) => message.deliveryStatus || confirmedIds.has(message.id),
  )
  return [...virtualMessages, ...(visibleCount ? regularMessages.slice(-visibleCount) : [])]
}

export function visibleMessageGap(gap: MessageGap | null, messages: DesktopMessage[]) {
  return gap &&
    messages.some((message) => message.seq === gap.afterSeq) &&
    messages.some((message) => message.seq === gap.beforeSeq)
    ? gap
    : null
}
