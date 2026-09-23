import type { DesktopConversation } from "../../../shared/account-data"

export const CONVERSATION_STATUS_HEARTBEAT_MS = 3_000
export const CONVERSATION_STATUS_TTL_MS = 5_000

export function shouldSendConversationStatus(
  conversation: DesktopConversation | null,
  draft: string,
  focused: boolean,
  visible: boolean,
  realtimeReady: boolean,
) {
  return (
    Boolean(conversation) &&
    (conversation?.type === "direct" || conversation?.type === "app") &&
    conversation.canSend !== false &&
    realtimeReady &&
    focused &&
    visible &&
    Boolean(draft.trim())
  )
}
