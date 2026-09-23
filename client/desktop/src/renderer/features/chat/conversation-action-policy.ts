import type { DesktopConversation } from "../../../shared/account-data"

export function canPinConversation(
  conversation: Pick<DesktopConversation, "type" | "isBuiltinAssistant">,
) {
  return conversation.type !== "topic" && !conversation.isBuiltinAssistant
}
