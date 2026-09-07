export type ConversationMessageWindowMode = "latest" | "history"

export type ConversationMessageWindowRequestKind =
  "initial" | "before" | "after" | "sync"

export class ConversationMessageWindowCoordinator {
  private readonly committedConversationIds = new Set<string>()
  private readonly desiredModes = new Map<
    string,
    ConversationMessageWindowMode
  >()
  private readonly inFlightRequests = new Map<
    ConversationMessageWindowRequestKind,
    Map<string, symbol>
  >()
  private readonly requestVersions = new Map<string, number>()

  invalidateAllRequests() {
    const conversationIds = new Set(this.requestVersions.keys())
    for (const requests of this.inFlightRequests.values()) {
      for (const conversationId of requests.keys()) {
        conversationIds.add(conversationId)
      }
    }
    for (const conversationId of conversationIds) {
      this.requestVersions.set(
        conversationId,
        this.getRequestVersion(conversationId) + 1
      )
    }
    this.desiredModes.clear()
    this.inFlightRequests.clear()
    this.committedConversationIds.clear()
  }

  beginWindowRequest(
    conversationId: string,
    mode: ConversationMessageWindowMode
  ) {
    this.desiredModes.set(conversationId, mode)
    const version = this.getRequestVersion(conversationId) + 1
    this.requestVersions.set(conversationId, version)
    for (const requests of this.inFlightRequests.values()) {
      requests.delete(conversationId)
    }
    return version
  }

  finishRequest(
    kind: ConversationMessageWindowRequestKind,
    conversationId: string,
    token: symbol
  ) {
    const requests = this.inFlightRequests.get(kind)
    if (requests?.get(conversationId) !== token) {
      return
    }
    requests.delete(conversationId)
    if (requests.size === 0) {
      this.inFlightRequests.delete(kind)
    }
  }

  getDesiredMode(conversationId: string) {
    return this.desiredModes.get(conversationId)
  }

  getRequestVersion(conversationId: string) {
    return this.requestVersions.get(conversationId) ?? 0
  }

  requestIsCurrent(conversationId: string, version: number) {
    return this.getRequestVersion(conversationId) === version
  }

  setDesiredMode(conversationId: string, mode: ConversationMessageWindowMode) {
    this.desiredModes.set(conversationId, mode)
  }

  synchronizeDesiredModes(
    states: Readonly<
      Record<string, { viewMode: ConversationMessageWindowMode } | undefined>
    >
  ) {
    for (const [conversationId, desiredMode] of this.desiredModes) {
      const state = states[conversationId]
      if (
        state?.viewMode === desiredMode ||
        (!state && this.committedConversationIds.has(conversationId))
      ) {
        this.desiredModes.delete(conversationId)
      }
    }
    this.committedConversationIds.clear()
    for (const conversationId of Object.keys(states)) {
      this.committedConversationIds.add(conversationId)
    }
  }

  tryBeginRequest(
    kind: ConversationMessageWindowRequestKind,
    conversationId: string
  ) {
    const requests =
      this.inFlightRequests.get(kind) ?? new Map<string, symbol>()
    if (requests.has(conversationId)) {
      return null
    }

    const token = Symbol(`${kind}:${conversationId}`)
    requests.set(conversationId, token)
    this.inFlightRequests.set(kind, requests)
    return token
  }
}
