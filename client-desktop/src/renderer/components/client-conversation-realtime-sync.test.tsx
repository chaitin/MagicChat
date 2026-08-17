import { act, render, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const callbacks = new Map<string, (payload: unknown) => void>()
const updateConversationMuted = vi.fn()
const refreshConversations = vi.fn().mockResolvedValue(undefined)
const syncLoadedConversationMessages = vi.fn()

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: true,
    subscribeRealtimeEvent: (event: string, callback: (payload: unknown) => void) => {
      callbacks.set(event, callback)
      return () => callbacks.delete(event)
    },
  }),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    foregroundConversationId: "",
    handleIncomingConversationMessage: vi.fn(),
    handleIncomingConversationMessageUpdate: vi.fn(),
    handleIncomingMessageReactionsUpdate: vi.fn(),
    refreshConversations,
    removeConversation: vi.fn(),
    syncLoadedConversationMessages,
    updateConversationLastMentionedSeq: vi.fn(),
    updateConversationMuted,
    updateConversationPinned: vi.fn(),
    updateMessageTopic: vi.fn(),
  }),
}))

import { ClientConversationRealtimeSync } from "@/components/client-conversation-realtime-sync"

describe("ClientConversationRealtimeSync", () => {
  beforeEach(() => {
    callbacks.clear()
    refreshConversations.mockClear()
    syncLoadedConversationMessages.mockClear()
    updateConversationMuted.mockClear()
  })

  it("首次以 ready 状态挂载时也会触发已知会话追赶", () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    expect(syncLoadedConversationMessages).toHaveBeenCalledOnce()
    expect(refreshConversations).not.toHaveBeenCalled()
  })

  it("每次 system.ready 均在刷新会话列表后触发消息补偿", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )
    refreshConversations.mockClear()
    syncLoadedConversationMessages.mockClear()

    act(() => callbacks.get("system.ready")?.({}))

    await waitFor(() => expect(refreshConversations).toHaveBeenCalledOnce())
    await waitFor(() => expect(syncLoadedConversationMessages).toHaveBeenCalledOnce())
    expect(refreshConversations.mock.invocationCallOrder[0]).toBeLessThan(
      syncLoadedConversationMessages.mock.invocationCallOrder[0],
    )
  })

  it("applies conversation mute realtime events", () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.mute_updated")?.({
        conversation_id: "conversation-1",
        muted: true,
      })
    })

    expect(updateConversationMuted).toHaveBeenCalledWith("conversation-1", true)
  })

  it("refreshes conversations for a valid restored event and ignores malformed payloads", async () => {
    render(
      <MemoryRouter initialEntries={["/chat/conversation-1"]}>
        <ClientConversationRealtimeSync />
      </MemoryRouter>,
    )

    act(() => {
      callbacks.get("conversation.restored")?.({ conversation_id: "conversation-2" })
      callbacks.get("conversation.restored")?.({ conversation_id: "" })
    })

    await waitFor(() => expect(refreshConversations).toHaveBeenCalledOnce())
  })
})
