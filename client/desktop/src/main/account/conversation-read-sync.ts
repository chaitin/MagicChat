import { AuthFailure, isRecord } from "../../shared/auth"
import type { AccountDatabase } from "./account-database"
import type { AuthenticatedClient } from "./authenticated-client"

export class ConversationReadSync {
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private closed = false
  private retryDelay = 1_000

  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
    private readonly onChanged: (conversationId: string) => void,
  ) {
    this.schedule(0)
  }

  enqueue(conversationId: string, upToSeq: number) {
    this.database.queueConversationRead(conversationId, upToSeq)
    this.schedule(0)
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
  }

  private schedule(delay: number) {
    if (this.closed || this.running || this.timer !== undefined) return
    if (this.database.listPendingConversationReads().length === 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, delay)
    this.timer.unref()
  }

  private async flush() {
    this.running = true
    let failed = false
    try {
      for (const { conversationId, upToSeq } of this.database.listPendingConversationReads()) {
        if (this.closed) return
        try {
          const data = await this.client.post(
            `/api/client/conversations/${encodeURIComponent(conversationId)}/read`,
            { up_to_seq: upToSeq },
          )
          if (this.closed) return
          if (
            !isRecord(data) ||
            data.conversation_id !== conversationId ||
            typeof data.last_read_seq !== "number" ||
            !Number.isSafeInteger(data.last_read_seq) ||
            data.last_read_seq < upToSeq
          ) {
            throw new AuthFailure("invalid_response", "会话已读响应格式不正确")
          }
          this.database.acknowledgeConversationRead(conversationId, data.last_read_seq)
          this.onChanged(conversationId)
        } catch {
          if (this.closed) return
          failed = true
        }
      }
    } finally {
      this.running = false
      if (!this.closed) {
        const delay = failed ? this.retryDelay : 0
        this.retryDelay = failed ? Math.min(this.retryDelay * 2, 30_000) : 1_000
        this.schedule(delay)
      }
    }
  }
}
