import { describe, expect, it } from "vitest"

import { ConversationMessageWindowCoordinator } from "@/lib/conversation-message-window-coordinator"

describe("ConversationMessageWindowCoordinator", () => {
  it("keeps a synchronous window intent until its state is committed", () => {
    const coordinator = new ConversationMessageWindowCoordinator()

    coordinator.beginWindowRequest("conversation-1", "history")
    coordinator.synchronizeDesiredModes({})

    expect(coordinator.getDesiredMode("conversation-1")).toBe("history")

    coordinator.synchronizeDesiredModes({
      "conversation-1": { viewMode: "history" },
    })

    expect(coordinator.getDesiredMode("conversation-1")).toBeUndefined()
  })

  it("discards an uncommitted intent after an existing state is removed", () => {
    const coordinator = new ConversationMessageWindowCoordinator()
    coordinator.synchronizeDesiredModes({
      "conversation-1": { viewMode: "latest" },
    })
    coordinator.beginWindowRequest("conversation-1", "history")

    coordinator.synchronizeDesiredModes({})

    expect(coordinator.getDesiredMode("conversation-1")).toBeUndefined()
  })

  it("invalidates every in-flight request when the account changes", () => {
    const coordinator = new ConversationMessageWindowCoordinator()
    const version = coordinator.getRequestVersion("conversation-1")
    expect(
      coordinator.tryBeginRequest("initial", "conversation-1")
    ).not.toBeNull()

    coordinator.invalidateAllRequests()

    expect(coordinator.requestIsCurrent("conversation-1", version)).toBe(false)
    expect(
      coordinator.tryBeginRequest("initial", "conversation-1")
    ).not.toBeNull()
  })

  it("does not let a stale request release a newer request lock", () => {
    const coordinator = new ConversationMessageWindowCoordinator()
    const staleToken = coordinator.tryBeginRequest("after", "conversation-1")
    expect(staleToken).not.toBeNull()

    coordinator.beginWindowRequest("conversation-1", "history")
    const currentToken = coordinator.tryBeginRequest("after", "conversation-1")
    expect(currentToken).not.toBeNull()

    coordinator.finishRequest("after", "conversation-1", staleToken!)

    expect(coordinator.tryBeginRequest("after", "conversation-1")).toBeNull()
    coordinator.finishRequest("after", "conversation-1", currentToken!)
    expect(
      coordinator.tryBeginRequest("after", "conversation-1")
    ).not.toBeNull()
  })
})
