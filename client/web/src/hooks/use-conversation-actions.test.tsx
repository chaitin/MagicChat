import { useState } from "react"
import { act, renderHook } from "@testing-library/react"
import type { NavigateFunction } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  type ClientConversation,
  ClientDataRequestError,
} from "@/lib/client-data-api"
import type {
  ClientConversationMessageState,
  ClientDataContextValue,
} from "@/lib/client-data-context"

import { useConversationActions } from "./use-conversation-actions"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("useConversationActions", () => {
  it("does not turn a saved announcement into a failure when contacts cannot refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              conversation: {
                announcement: "新公告",
                created_at: "2026-07-30T09:30:00Z",
                id: "conversation-group-1",
                name: "新品讨论组",
                type: "group",
              },
              message: null,
            },
            success: true,
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    )
    const refreshContacts = vi
      .fn()
      .mockRejectedValue(new Error("contacts unavailable"))
    const handleError = vi.fn(
      (_error: unknown, fallbackMessage: string) =>
        new ClientDataRequestError(fallbackMessage)
    )
    const mergeIncomingConversationMessage = vi.fn()
    const navigate = vi.fn() as NavigateFunction

    const { result } = renderHook(() => {
      const [conversations, setConversations] = useState<ClientConversation[]>(
        []
      )
      const [conversationMessageStates, setConversationMessageStates] =
        useState<Record<string, ClientConversationMessageState>>({})
      const actions = useConversationActions({
        conversations,
        conversationMessageStates,
        handleError,
        mergeIncomingConversationMessage:
          mergeIncomingConversationMessage as ClientDataContextValue["mergeIncomingConversationMessage"],
        navigate,
        refreshContacts,
        setConversationMessageStates,
        setConversations,
      })

      return { actions, conversations }
    })

    await act(async () => {
      await expect(
        result.current.actions.updateGroupConversationAnnouncement(
          "conversation-group-1",
          "新公告"
        )
      ).resolves.toMatchObject({ announcement: "新公告" })
    })

    expect(result.current.conversations[0]).toMatchObject({
      announcement: "新公告",
      id: "conversation-group-1",
    })
    expect(refreshContacts).not.toHaveBeenCalled()
    expect(handleError).not.toHaveBeenCalled()
  })
})
