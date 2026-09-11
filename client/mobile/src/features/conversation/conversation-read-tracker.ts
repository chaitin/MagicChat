export type ConversationReadSnapshot = {
  conversationId: string
  lastMessageSeq: number
  lastReadSeq: number
  newestLoadedSeq: number
  unreadCount: number
}

export class ConversationReadTracker {
  private confirmedSeq = 0
  private conversationId = ""
  private requestedSeq = 0

  nextRequest(snapshot: ConversationReadSnapshot) {
    this.observe(snapshot.conversationId, snapshot.lastReadSeq)

    const newestSeq = Math.max(
      snapshot.lastMessageSeq,
      snapshot.newestLoadedSeq
    )
    const hasUnreadProgress =
      snapshot.unreadCount > 0 || newestSeq > this.requestedSeq
    if (!hasUnreadProgress) return null

    this.requestedSeq = Math.max(this.requestedSeq, newestSeq)
    return newestSeq
  }

  confirm(conversationId: string, lastReadSeq: number) {
    if (this.conversationId !== conversationId) return

    this.confirmedSeq = Math.max(this.confirmedSeq, lastReadSeq)
    this.requestedSeq = Math.max(this.requestedSeq, this.confirmedSeq)
  }

  fail(conversationId: string, requestedSeq: number) {
    if (
      this.conversationId === conversationId &&
      this.requestedSeq === requestedSeq
    ) {
      this.requestedSeq = this.confirmedSeq
    }
  }

  private observe(conversationId: string, lastReadSeq: number) {
    if (this.conversationId !== conversationId) {
      this.conversationId = conversationId
      this.confirmedSeq = lastReadSeq
      this.requestedSeq = lastReadSeq
      return
    }

    this.confirmedSeq = Math.max(this.confirmedSeq, lastReadSeq)
    this.requestedSeq = Math.max(this.requestedSeq, lastReadSeq)
  }
}
