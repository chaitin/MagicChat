import type { DesktopMessage } from "../../../shared/account-data"
import { MAX_VISIBLE_MESSAGES, type MessageGap } from "../../../shared/message-window.ts"

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

export function visibleMessageGap(gap: MessageGap | null, messages: DesktopMessage[]) {
  return gap &&
    messages.some((message) => message.seq === gap.afterSeq) &&
    messages.some((message) => message.seq === gap.beforeSeq)
    ? gap
    : null
}
