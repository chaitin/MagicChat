import * as React from "react"
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useConversationStatus } from "@/hooks/use-conversation-status"
import {
  RealtimeContext,
  type RealtimeContextValue,
} from "@/lib/realtime-context"

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    normalizeMessageCreatedEventPayload: (payload: unknown) => payload,
  }
})

type Handler = (payload: unknown) => void

function setup(supported = true) {
  const handlers = new Map<string, Handler>()
  const sendRealtimeRequest = vi.fn().mockResolvedValue(undefined)
  const value: RealtimeContextValue = {
    ready: true,
    status: "connected",
    sendRealtimeRequest,
    subscribeRealtimeEvent: vi.fn((name, handler) => {
      handlers.set(name, handler)
      return () => handlers.delete(name)
    }),
  }
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  )
  const hook = renderHook(
    ({ enabled, conversationId }) =>
      useConversationStatus({
        conversationId,
        supported: enabled,
      }),
    {
      initialProps: { enabled: supported, conversationId: "conversation-1" },
      wrapper,
    }
  )
  return { ...hook, handlers, realtime: value, sendRealtimeRequest }
}

function emitStatus(handlers: Map<string, Handler>, status = "正在输入") {
  act(() =>
    handlers.get("conversation.status")?.({
      conversation_id: "conversation-1",
      status,
      sender: { id: "user-2", type: "user" },
    })
  )
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  })
  act(() => document.dispatchEvent(new Event("visibilitychange")))
}

describe("useConversationStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it("expires a received status after five seconds", () => {
    const { result, handlers } = setup()
    emitStatus(handlers, "处理中")
    expect(result.current.status).toBe("处理中")
    act(() => vi.advanceTimersByTime(4_999))
    expect(result.current.status).toBe("处理中")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.status).toBeUndefined()
  })

  it("refreshes the expiry when another status arrives", () => {
    const { result, handlers } = setup()
    emitStatus(handlers, "第一条")
    act(() => vi.advanceTimersByTime(4_000))
    emitStatus(handlers, "第二条")
    act(() => vi.advanceTimersByTime(4_999))
    expect(result.current.status).toBe("第二条")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.status).toBeUndefined()
  })

  it("clears status immediately for a message from the same sender", () => {
    const { result, handlers } = setup()
    emitStatus(handlers)
    act(() =>
      handlers.get("message.created")?.({
        conversationId: "conversation-1",
        sender: { id: "user-2", type: "user" },
      })
    )
    expect(result.current.status).toBeUndefined()
  })

  it("clears status when status and message events arrive back to back", () => {
    const { result, handlers } = setup()
    act(() => {
      handlers.get("conversation.status")?.({
        conversation_id: "conversation-1",
        status: "正在输入",
        sender: { id: "user-2", type: "user" },
      })
      handlers.get("message.created")?.({
        conversationId: "conversation-1",
        sender: { id: "user-2", type: "user" },
      })
    })
    expect(result.current.status).toBeUndefined()
  })

  it("clears received statuses across a disconnect and reconnect", () => {
    const { handlers, realtime, rerender, result } = setup()
    emitStatus(handlers)
    expect(result.current.status).toBe("正在输入")

    realtime.ready = false
    rerender({ enabled: true, conversationId: "conversation-1" })
    expect(result.current.status).toBeUndefined()

    realtime.ready = true
    rerender({ enabled: true, conversationId: "conversation-1" })
    expect(result.current.status).toBeUndefined()
  })

  it("sends while focused with a non-empty draft and every three seconds", () => {
    const { result, sendRealtimeRequest } = setup()
    act(() => result.current.onFocus())
    expect(sendRealtimeRequest).not.toHaveBeenCalled()
    act(() => result.current.onDraftChange("hello"))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith(
      "conversation.status",
      {
        conversation_id: "conversation-1",
        status: "正在输入",
      }
    )
    act(() => vi.advanceTimersByTime(3_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
  })

  it("stops heartbeating until the new conversation input is focused", () => {
    const { result, rerender, sendRealtimeRequest } = setup()
    act(() => {
      result.current.onFocus()
      result.current.onDraftChange("hello")
    })
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith(
      "conversation.status",
      expect.objectContaining({ conversation_id: "conversation-1" })
    )

    rerender({ enabled: true, conversationId: "conversation-2" })
    const callsAfterSwitch = sendRealtimeRequest.mock.calls.length
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(callsAfterSwitch)

    act(() => {
      result.current.onFocus()
      result.current.onDraftChange("new draft")
    })
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith(
      "conversation.status",
      expect.objectContaining({ conversation_id: "conversation-2" })
    )
    act(() => vi.advanceTimersByTime(3_000))
    expect(sendRealtimeRequest).toHaveBeenLastCalledWith(
      "conversation.status",
      expect.objectContaining({ conversation_id: "conversation-2" })
    )
  })

  it("stops on blur and while hidden", () => {
    const { result, sendRealtimeRequest } = setup()
    act(() => {
      result.current.onFocus()
      result.current.onDraftChange("hello")
    })
    act(() => result.current.onBlur())
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)

    act(() => result.current.onFocus())
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
    setVisibility("hidden")
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(2)
  })

  it("does not send for unsupported conversations", () => {
    const { result, sendRealtimeRequest } = setup(false)
    act(() => {
      result.current.onFocus()
      result.current.onDraftChange("hello")
    })
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).not.toHaveBeenCalled()
  })

  it("stops heartbeating when the draft becomes blank", () => {
    const { result, sendRealtimeRequest } = setup()
    act(() => {
      result.current.onFocus()
      result.current.onDraftChange("hello")
    })
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)

    act(() => result.current.onDraftChange("   "))
    act(() => vi.advanceTimersByTime(6_000))
    expect(sendRealtimeRequest).toHaveBeenCalledTimes(1)
  })
})
