import * as React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ClientConversation } from "@/lib/client-data-api"
import type { ConversationPanelMessage } from "@/lib/conversation-panel-types"
import { ConversationPanelHistory } from "@/components/conversation/conversation-panel-history"
import { formatConversationMessageTime } from "@/lib/conversation-message-presenter"

const testState = vi.hoisted(() => ({
  anchorTop: 100,
  bubbleRenderCount: 0,
  clientHeight: 400,
  contentSizeChanged: false,
  frameCallback: null as FrameRequestCallback | null,
  messageTopShifts: {} as Record<string, number>,
  messageTops: {} as Record<string, number>,
  resizeObserverCallback: null as ResizeObserverCallback | null,
  scrollIntoView: vi.fn(),
  scrollHeight: 1_000,
}))

const defaultResizeObserver = window.ResizeObserver

class ControlledResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    testState.resizeObserverCallback = callback
  }

  disconnect() {}
  observe() {}
  unobserve() {}
}

vi.mock("@/components/ui/scroll-area", () => {
  return {
    ScrollArea({
      children,
      viewportProps,
      viewportRef,
    }: {
      children: React.ReactNode
      viewportProps?: React.HTMLAttributes<HTMLDivElement>
      viewportRef?: React.Ref<HTMLDivElement>
    }) {
      function setViewportRef(node: HTMLDivElement | null) {
        if (node) {
          Object.defineProperties(node, {
            clientHeight: {
              configurable: true,
              get: () => testState.clientHeight,
            },
            scrollHeight: {
              configurable: true,
              get: () => testState.scrollHeight,
            },
          })
        }

        if (typeof viewportRef === "function") {
          viewportRef(node)
        } else if (viewportRef) {
          viewportRef.current = node
        }
      }

      return (
        <div>
          <div {...viewportProps} data-slot="scroll-area-viewport" ref={setViewportRef}>
            {children}
          </div>
        </div>
      )
    },
  }
})

vi.mock("@/components/conversation/conversation-message", () => ({
  MessageBubble({
    message,
    onContentSizeChange,
  }: {
    message: ConversationPanelMessage
    onContentSizeChange?: (messageId: string) => void
  }) {
    testState.bubbleRenderCount += 1
    return (
      <div
        data-conversation-message-id={message.id}
        data-testid={`message-${message.id}`}
        ref={(node) => {
          if (node) {
            node.getBoundingClientRect = () => {
              const top =
                (testState.messageTops[message.id] ?? testState.anchorTop) +
                (testState.contentSizeChanged ? (testState.messageTopShifts[message.id] ?? 0) : 0)
              return { bottom: top + 60, top } as DOMRect
            }
            node.scrollIntoView = testState.scrollIntoView
          }
        }}
      >
        {message.author}
        <button
          onClick={() => {
            onContentSizeChange?.(message.id)
            testState.contentSizeChanged = true
          }}
          type="button"
        >
          改变高度 {message.id}
        </button>
      </div>
    )
  },
  SystemMessageBadge({ message }: { message: ConversationPanelMessage }) {
    return (
      <div data-conversation-message-id={message.id} data-testid={`message-${message.id}`}>
        {message.author}
      </div>
    )
  },
}))

describe("ConversationPanelHistory", () => {
  beforeEach(() => {
    testState.anchorTop = 100
    testState.bubbleRenderCount = 0
    testState.clientHeight = 400
    testState.contentSizeChanged = false
    testState.frameCallback = null
    testState.messageTopShifts = {}
    testState.messageTops = {}
    testState.resizeObserverCallback = null
    testState.scrollIntoView.mockReset()
    testState.scrollHeight = 1_000
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ControlledResizeObserver,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: defaultResizeObserver,
    })
  })

  it("follows an incoming message when already near the bottom", () => {
    const props = createProps([createMessage("message-1", "other")])
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()

    testState.scrollHeight = 1_100
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[...props.messages, createMessage("message-2", "other")]}
      />,
    )

    expect(viewport.scrollTop).toBe(1_100)
    expect(screen.queryByText(/条新消息/)).not.toBeInTheDocument()
  })

  it("retries loading when the empty history error action is clicked", () => {
    const onRetry = vi.fn()
    render(<ConversationPanelHistory {...createProps([])} error="加载消息失败" onRetry={onRetry} />)

    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("stays at the bottom when existing message content grows", () => {
    const props = createProps([createMessage("message-1", "other")])
    render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()

    testState.scrollHeight = 1_100
    testState.resizeObserverCallback?.([], {} as ResizeObserver)

    expect(viewport.scrollTop).toBe(1_100)
  })

  it("does not move when existing message content grows away from the bottom", () => {
    const props = createProps([createMessage("message-1", "other")])
    render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)

    testState.scrollHeight = 1_100
    testState.resizeObserverCallback?.([], {} as ResizeObserver)

    expect(viewport.scrollTop).toBe(100)
  })

  it("展开靠近底部的消息后继续贴底", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const props = createProps([createMessage("message-1", "other")])
    render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    testState.scrollHeight = 1_200

    fireEvent.click(screen.getByRole("button", { name: "改变高度 message-1" }))

    expect(viewport.scrollTop).toBe(1_200)
  })

  it("展开视口中部的消息后保持该消息屏幕锚点", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const props = createProps([createMessage("message-1", "other")])
    render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    testState.anchorTop = 160

    fireEvent.click(screen.getByRole("button", { name: "改变高度 message-1" }))

    expect(viewport.scrollTop).toBe(100)
  })

  it("展开视口上方的消息后保持首个可见消息的屏幕锚点", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      testState.frameCallback = callback
      return 1
    })
    testState.messageTops = { "message-1": -200, "message-2": 150 }
    testState.messageTopShifts = { "message-2": 200 }
    const props = createProps([
      createMessage("message-1", "other"),
      createMessage("message-2", "other"),
    ])
    render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    testState.scrollHeight = 1_200

    fireEvent.click(screen.getByRole("button", { name: "改变高度 message-1" }))
    act(() => testState.frameCallback?.(0))

    expect(viewport.scrollTop).toBe(300)
  })

  it("keeps the reading position and reports incoming messages away from the bottom", () => {
    const props = createProps([createMessage("message-1", "other")])
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)

    testState.scrollHeight = 1_100
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[...props.messages, createMessage("message-2", "other")]}
      />,
    )

    expect(viewport.scrollTop).toBe(100)
    expect(screen.getByRole("button", { name: "1 条新消息" })).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "1 条新消息" }))

    expect(viewport.scrollTop).toBe(1_100)
    expect(screen.queryByText(/条新消息/)).not.toBeInTheDocument()
  })

  it("follows a message sent by the current user away from the bottom", () => {
    const props = createProps([createMessage("message-1", "other")])
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)

    testState.scrollHeight = 1_100
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[...props.messages, createMessage("message-2", "me")]}
      />,
    )

    expect(viewport.scrollTop).toBe(1_100)
    expect(screen.queryByText(/条新消息/)).not.toBeInTheDocument()
  })

  it("preserves the visible position when older messages are prepended", () => {
    const onLoadBeforeMessages = vi.fn()
    const props = createProps([createMessage("message-2", "other")], onLoadBeforeMessages)
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 20
    fireEvent.scroll(viewport)

    expect(onLoadBeforeMessages).toHaveBeenCalledOnce()

    testState.anchorTop = 300
    testState.scrollHeight = 1_200
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[createMessage("message-1", "other"), ...props.messages]}
      />,
    )

    expect(viewport.scrollTop).toBe(220)
  })

  it("handles older and newer messages arriving in the same render", () => {
    const props = createProps([createMessage("message-2", "other")])
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 20
    fireEvent.scroll(viewport)

    testState.anchorTop = 300
    testState.scrollHeight = 1_300
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[
          createMessage("message-1", "other"),
          ...props.messages,
          createMessage("message-3", "other"),
        ]}
      />,
    )

    expect(viewport.scrollTop).toBe(220)
    expect(screen.getByRole("button", { name: "1 条新消息" })).toBeVisible()
  })

  it("does not rerender message rows when all history props are unchanged", () => {
    const props = createProps([createMessage("message-1", "other")])
    const { rerender } = render(<ConversationPanelHistory {...props} />)

    expect(testState.bubbleRenderCount).toBe(1)

    rerender(<ConversationPanelHistory {...props} />)

    expect(testState.bubbleRenderCount).toBe(1)
  })

  it("定位焦点消费后，向后分页不会再次滚回目标消息", async () => {
    const focus = { messageId: "message-1", requestKey: 1 }
    const onConsumeFocus = vi.fn()
    const messages = [createMessage("message-1", "other")]
    const props = {
      ...createProps(messages),
      focus,
      historyMode: true,
      onConsumeFocus,
    }
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(testState.scrollIntoView).toHaveBeenCalledOnce()
    expect(testState.scrollIntoView).toHaveBeenCalledWith({ block: "center" })
    expect(onConsumeFocus).toHaveBeenCalledWith(focus)

    rerender(
      <ConversationPanelHistory
        {...props}
        focus={null}
        messages={[...messages, createMessage("message-2", "other")]}
      />,
    )
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(testState.scrollIntoView).toHaveBeenCalledOnce()
  })

  it("新的 requestKey 可以重新定位同一条消息", async () => {
    const onConsumeFocus = vi.fn()
    const messages = [createMessage("message-1", "other")]
    const props = {
      ...createProps(messages),
      focus: { messageId: "message-1", requestKey: 1 },
      historyMode: true,
      onConsumeFocus,
    }
    const { rerender } = render(<ConversationPanelHistory {...props} />)

    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })
    rerender(
      <ConversationPanelHistory {...props} focus={{ messageId: "message-1", requestKey: 2 }} />,
    )
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(onConsumeFocus).toHaveBeenNthCalledWith(1, {
      messageId: "message-1",
      requestKey: 1,
    })
    expect(onConsumeFocus).toHaveBeenNthCalledWith(2, {
      messageId: "message-1",
      requestKey: 2,
    })
  })

  it("从历史模式返回最新时等待列表恢复并校准到真实底部", async () => {
    const historyMessages = [createMessage("message-1", "other")]
    const props = {
      ...createProps(historyMessages),
      historyMode: true,
    }
    const { rerender } = render(<ConversationPanelHistory {...props} />)
    const viewport = getViewport()
    viewport.scrollTop = 120

    rerender(<ConversationPanelHistory {...props} historyMode={false} loading />)

    testState.scrollHeight = 1_200
    rerender(<ConversationPanelHistory {...props} historyMode={false} />)
    const latestViewport = getViewport()

    expect(latestViewport.scrollTop).toBe(1_200)

    testState.scrollHeight = 1_400
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
    })

    expect(latestViewport.scrollTop).toBe(1_400)

    testState.scrollHeight = 1_600
    rerender(
      <ConversationPanelHistory
        {...props}
        historyMode={false}
        messages={[...historyMessages, createMessage("message-2", "other")]}
      />,
    )

    expect(latestViewport.scrollTop).toBe(1_600)
  })

  it("protects prepended history for three minutes without resetting for new messages", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:00:00Z"))
    const onCompactMessages = vi.fn()
    const originalMessages = Array.from({ length: 300 }, (_, index) =>
      createMessage(`message-${index + 2}`, "other"),
    )
    const props = { ...createProps(originalMessages), onCompactMessages }
    const { rerender } = render(<ConversationPanelHistory {...props} />)

    rerender(<ConversationPanelHistory {...props} loadingBefore />)
    const prependedMessages = [createMessage("message-1", "other"), ...originalMessages]
    rerender(<ConversationPanelHistory {...props} loadingBefore messages={prependedMessages} />)
    rerender(<ConversationPanelHistory {...props} messages={prependedMessages} />)
    expect(onCompactMessages).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    })
    rerender(
      <ConversationPanelHistory
        {...props}
        messages={[...prependedMessages, createMessage("message-302", "other")]}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000 - 1)
    })
    expect(onCompactMessages).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(onCompactMessages).toHaveBeenCalledOnce()
  })

  it("marks the newer message when adjacent messages are more than one hour apart", () => {
    const firstMessage = createMessage("message-1", "other", "2026-07-21T10:00:00Z")
    const exactlyOneHourLater = createMessage("message-2", "other", "2026-07-21T11:00:00Z")
    const moreThanOneHourLater = createMessage("message-3", "other", "2026-07-21T12:00:01Z")

    render(
      <ConversationPanelHistory
        {...createProps([firstMessage, exactlyOneHourLater, moreThanOneHourLater])}
      />,
    )

    const markers = document.querySelectorAll("[data-message-time-marker]")
    expect(markers).toHaveLength(1)
    expect(markers[0]).toHaveTextContent(
      formatConversationMessageTime(moreThanOneHourLater.createdAt),
    )
  })
})

function getViewport() {
  const viewport = document.querySelector<HTMLDivElement>('[data-slot="scroll-area-viewport"]')
  if (!viewport) {
    throw new Error("消息历史滚动容器不存在")
  }
  return viewport
}

function createProps(messages: ConversationPanelMessage[], onLoadBeforeMessages = vi.fn()) {
  return {
    conversation: createConversation(),
    currentUserId: "user-me",
    error: null,
    loading: false,
    loadingBefore: false,
    mentionLabelResolver: () => undefined,
    messages,
    onInsertMention: vi.fn(),
    onLoadBeforeMessages,
    onReplyToMessage: vi.fn(),
    onRevokeMessage: vi.fn(),
  }
}

function createConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-14T10:00:00Z",
    id: "conversation-1",
    lastMentionedSeq: 0,
    lastMessageAt: "2026-07-14T10:00:00Z",
    lastMessageId: "message-1",
    lastMessageSeq: 1,
    lastMessageSummary: "测试消息",
    lastChoiceSeq: 0,
    lastReadSeq: 1,
    memberCount: 2,
    name: "测试会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}

function createMessage(
  id: string,
  role: ConversationPanelMessage["role"],
  createdAt = "2026-07-14T10:00:00Z",
): ConversationPanelMessage {
  return {
    author: role === "me" ? "我" : "Alice",
    avatar: "",
    body: { content: id, type: "text" },
    canRevoke: role === "me",
    createdAt,
    delegatedByName: "",
    id,
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role,
    senderAppId: "",
    senderAppProfile: null,
    senderUserId: role === "me" ? "user-me" : "user-other",
    time: "10:00",
  }
}
