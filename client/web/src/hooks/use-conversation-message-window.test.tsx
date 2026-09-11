import * as React from "react"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientMessage, ClientMessageList } from "@/lib/client-data-api"
import type { ClientConversationMessageState } from "@/lib/client-data-context"
import { createConversationMessageState } from "@/lib/client-data-state"
import { useConversationMessageWindow } from "@/hooks/use-conversation-message-window"

const mocks = vi.hoisted(() => ({
  listConversationMessages: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    listConversationMessages: mocks.listConversationMessages,
  }
})

describe("useConversationMessageWindow", () => {
  beforeEach(() => {
    mocks.listConversationMessages.mockReset()
  })

  it("opens a focused history window and pages in both directions", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.beforeSeq === 31) {
          return Promise.resolve(createPage(11, 30, true, true))
        }
        if (options.afterSeq === 70) {
          return Promise.resolve(createPage(71, 90, true, true))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)

    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )

    expect(result.current.state.viewMode).toBe("history")
    expect(result.current.state.messages[0]?.seq).toBe(31)
    expect(result.current.state.messages.at(-1)?.seq).toBe(70)
    expect(result.current.state.focus?.messageId).toBe("message-50")

    act(() =>
      result.current.actions.loadBeforeConversationMessages("conversation-1")
    )
    await waitFor(() => expect(result.current.state.loadingBefore).toBe(false))
    expect(result.current.state.messages[0]?.seq).toBe(11)

    act(() =>
      result.current.actions.loadAfterConversationMessages("conversation-1")
    )
    await waitFor(() => expect(result.current.state.loadingAfter).toBe(false))
    expect(result.current.state.messages.at(-1)?.seq).toBe(90)
    expect(result.current.state.viewMode).toBe("history")
  })

  it("replaces the history window when returning to latest messages", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.beforeSeq === undefined && options.afterSeq === undefined) {
          return Promise.resolve(createPage(181, 200, true, false))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)
    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )

    act(() =>
      result.current.actions.returnToLatestConversationMessages(
        "conversation-1"
      )
    )
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    expect(result.current.state.viewMode).toBe("latest")
    expect(result.current.state.focus).toBeNull()
    expect(result.current.state.messages[0]?.seq).toBe(181)
    expect(result.current.state.messages.at(-1)?.seq).toBe(200)
  })

  it("falls back to latest messages when the target is no longer available", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 49, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.beforeSeq === undefined && options.afterSeq === undefined) {
          return Promise.resolve(createPage(181, 200, true, false))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)

    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    expect(result.current.state.viewMode).toBe("latest")
    expect(result.current.state.focus).toBeNull()
    expect(result.current.state.messages[0]?.seq).toBe(181)
  })

  it("does not start a latest-page request while opening a focused window", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)

    await act(async () => {
      const focusRequest = result.current.actions.focusConversationMessage(
        "conversation-1",
        { messageId: "message-50", seq: 50 }
      )
      result.current.actions.ensureConversationMessages("conversation-1")
      await focusRequest
    })

    expect(mocks.listConversationMessages).toHaveBeenCalledTimes(2)
    expect(mocks.listConversationMessages).not.toHaveBeenCalledWith(
      "conversation-1",
      { limit: 20 }
    )
  })

  it("ignores an in-flight message response after account requests are invalidated", async () => {
    const stalePage = createDeferred<ClientMessageList>()
    mocks.listConversationMessages.mockReturnValue(stalePage.promise)
    const { result } = renderHook(useMessageWindowHarness)

    act(() => result.current.actions.ensureConversationMessages("conversation-1"))
    act(() => {
      result.current.actions.invalidateConversationMessageRequests()
      result.current.updateState(() => ({
        ...createConversationMessageState(),
        loaded: true,
        messages: [createMessage(300)],
      }))
    })
    await act(async () => {
      stalePage.resolve(createPage(1, 20, false, false))
      await stalePage.promise
    })

    expect(result.current.state.messages.map((message) => message.seq)).toEqual([
      300,
    ])
  })

  it("deduplicates concurrent requests for newer history messages", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.afterSeq === 70) {
          return Promise.resolve(createPage(71, 90, true, true))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)
    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )

    act(() => {
      result.current.actions.loadAfterConversationMessages("conversation-1")
      result.current.actions.loadAfterConversationMessages("conversation-1")
    })
    await waitFor(() => expect(result.current.state.loadingAfter).toBe(false))

    expect(
      mocks.listConversationMessages.mock.calls.filter(
        ([, options]) => options.afterSeq === 70
      )
    ).toHaveLength(1)
  })

  it("deduplicates concurrent requests for older history messages", async () => {
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.beforeSeq === 31) {
          return Promise.resolve(createPage(11, 30, true, true))
        }
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)
    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )

    act(() => {
      result.current.actions.loadBeforeConversationMessages("conversation-1")
      result.current.actions.loadBeforeConversationMessages("conversation-1")
    })
    await waitFor(() => expect(result.current.state.loadingBefore).toBe(false))

    expect(
      mocks.listConversationMessages.mock.calls.filter(
        ([, options]) => options.beforeSeq === 31
      )
    ).toHaveLength(1)
  })

  it("keeps realtime messages received while returning to latest", async () => {
    const latestPage = createDeferred<ClientMessageList>()
    mocks.listConversationMessages.mockReturnValue(latestPage.promise)
    const { result } = renderHook(useMessageWindowHarness)

    act(() =>
      result.current.actions.returnToLatestConversationMessages(
        "conversation-1"
      )
    )
    act(() => {
      result.current.updateState((currentState) => ({
        ...currentState,
        latestKnownSeq: 201,
        messages: [createMessage(201)],
      }))
    })
    await act(async () => {
      latestPage.resolve(createPage(181, 200, true, false))
      await latestPage.promise
    })
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    expect(result.current.state.messages.at(-1)?.seq).toBe(201)
    expect(result.current.state.page?.newestSeq).toBe(201)
  })

  it("stays in history when a new message arrives during focused loading", async () => {
    const beforePage = createDeferred<ClientMessageList>()
    const afterPage = createDeferred<ClientMessageList>()
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 181) return beforePage.promise
        if (options.afterSeq === 180) return afterPage.promise
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(useMessageWindowHarness)
    let focusRequest: Promise<void>

    act(() => {
      focusRequest = result.current.actions.focusConversationMessage(
        "conversation-1",
        { messageId: "message-180", seq: 180 }
      )
    })
    act(() => {
      result.current.updateState((currentState) => ({
        ...currentState,
        latestKnownSeq: 201,
        pendingLatestMessageCount: 1,
      }))
    })
    await act(async () => {
      beforePage.resolve(createPage(161, 180, true, true))
      afterPage.resolve(createPage(181, 200, true, false))
      await focusRequest
    })

    expect(result.current.state.viewMode).toBe("history")
    expect(result.current.state.page?.hasMoreAfter).toBe(true)
    expect(result.current.state.pendingLatestMessageCount).toBe(1)
  })

  it("stays in history when a new message arrives during newer pagination", async () => {
    const newerPage = createDeferred<ClientMessageList>()
    mocks.listConversationMessages.mockImplementation(
      (
        _conversationId: string,
        options: { afterSeq?: number; beforeSeq?: number }
      ) => {
        if (options.beforeSeq === 51) {
          return Promise.resolve(createPage(31, 50, true, true))
        }
        if (options.afterSeq === 50) {
          return Promise.resolve(createPage(51, 70, true, true))
        }
        if (options.afterSeq === 70) return newerPage.promise
        throw new Error(`unexpected options: ${JSON.stringify(options)}`)
      }
    )
    const { result } = renderHook(() => useMessageWindowHarness(90))
    await act(() =>
      result.current.actions.focusConversationMessage("conversation-1", {
        messageId: "message-50",
        seq: 50,
      })
    )

    act(() =>
      result.current.actions.loadAfterConversationMessages("conversation-1")
    )
    act(() => {
      result.current.updateState((currentState) => ({
        ...currentState,
        latestKnownSeq: 91,
        pendingLatestMessageCount: 1,
      }))
    })
    await act(async () => {
      newerPage.resolve(createPage(71, 90, true, false))
      await newerPage.promise
    })

    expect(result.current.state.viewMode).toBe("history")
    expect(result.current.state.page?.hasMoreAfter).toBe(true)
    expect(result.current.state.pendingLatestMessageCount).toBe(1)
  })
})

function useMessageWindowHarness(latestConversationSeq = 200) {
  const [states, setStates] = React.useState<
    Record<string, ClientConversationMessageState>
  >({})
  const statesRef = React.useRef(states)
  React.useLayoutEffect(() => {
    statesRef.current = states
  }, [states])
  const updateConversationMessageState = React.useCallback(
    (
      conversationId: string,
      updater: (
        state: ClientConversationMessageState
      ) => ClientConversationMessageState
    ) => {
      setStates((current) => ({
        ...current,
        [conversationId]: updater(
          current[conversationId] ?? createConversationMessageState()
        ),
      }))
    },
    []
  )
  const actions = useConversationMessageWindow({
    conversationMessageStates: states,
    conversationMessageStatesRef: statesRef,
    getConversationLatestSeq: () => latestConversationSeq,
    rememberConversationMessage: vi.fn(),
    updateConversationMessageState,
  })
  return {
    actions,
    state: states["conversation-1"] ?? createConversationMessageState(),
    updateState: (
      updater: (
        state: ClientConversationMessageState
      ) => ClientConversationMessageState
    ) => updateConversationMessageState("conversation-1", updater),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createPage(
  firstSeq: number,
  lastSeq: number,
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
): ClientMessageList {
  const messages = Array.from({ length: lastSeq - firstSeq + 1 }, (_, index) =>
    createMessage(firstSeq + index)
  )
  return {
    messages,
    page: {
      hasMoreAfter,
      hasMoreBefore,
      limit: 20,
      newestSeq: lastSeq,
      oldestSeq: firstSeq,
    },
  }
}

function createMessage(seq: number): ClientMessage {
  return {
    body: { content: `message-${seq}`, type: "text" },
    clientMessageId: "",
    conversationId: "conversation-1",
    createdAt: new Date(2026, 6, 1, 0, seq).toISOString(),
    id: `message-${seq}`,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq,
  }
}
