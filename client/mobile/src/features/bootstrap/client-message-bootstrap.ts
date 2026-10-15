import type { AuthenticatedTarget } from "@/core/server-target"
import { conversationManager } from "@/data/conversations"
import { messageManager } from "@/data/messages"
import { createMessageBootstrap } from "@/features/bootstrap/message-bootstrap"

const run = createMessageBootstrap({
  listLocalConversations: (target) => conversationManager.list(target),
  readLatestPage: (target, id, limit) => messageManager.readLatestPage(target, id, limit),
})

export function runClientMessageBootstrap(
  target: AuthenticatedTarget,
  onPage?: Parameters<typeof run>[1]
) {
  return run(target, onPage)
}
