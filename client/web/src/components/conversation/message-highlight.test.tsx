import * as React from "react"
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import {
  MessageBubble,
  SystemMessageBadge,
} from "@/components/conversation/conversation-message"
import type { ClientConversation } from "@/lib/client-data-api"
import type { ConversationPanelMessage } from "@/lib/conversation-panel-types"

vi.mock("@/components/user-profile-popover", () => ({
  UserProfilePopover: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock("@/components/message-image", () => ({
  MessageImage: () => <div>图片正文</div>,
}))
vi.mock("@/components/message-action-menu", () => ({
  MessageActionMenu: ({ children }: { children: React.ReactNode }) => children,
  MessageMoreActionsMenu: () => null,
}))

const defaultAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate"
)
const animations: {
  target: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  cancel: ReturnType<typeof vi.fn>
}[] = []

beforeEach(() => {
  animations.length = 0
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function (
      this: Element,
      frames: Keyframe[],
      options: KeyframeAnimationOptions
    ) {
      const animation = { target: this, frames, options, cancel: vi.fn() }
      animations.push(animation)
      return animation
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (defaultAnimate)
    Object.defineProperty(Element.prototype, "animate", defaultAnimate)
  else Reflect.deleteProperty(Element.prototype, "animate")
})

const conversation = {
  id: "room",
  name: "测试会话",
  type: "direct",
} as ClientConversation
const props = {
  conversation,
  currentUserId: "me",
  mentionLabelResolver: () => undefined,
  onInsertMention: vi.fn(),
}
function message(
  role: ConversationPanelMessage["role"] = "other"
): ConversationPanelMessage {
  return {
    id: "message",
    author: "Alice",
    avatar: "",
    role,
    body: { type: "text", content: "正文" },
    createdAt: "2026-10-20T10:00:00Z",
    time: "10:00",
    canRevoke: false,
    delegatedByName: "",
    mentionTarget: null,
    reactions: [],
    reactionVersion: 0,
    senderAppId: null,
    senderAppProfile: null,
    senderUserId: "alice",
  }
}

function expectOutline(target: Element) {
  expect(target).toHaveClass("ring-2", "ring-xgui-orange")
  expect(target).not.toHaveAttribute("data-conversation-message-id")
  expect(target.closest("[data-conversation-message-id]")).not.toHaveClass(
    "ring-2",
    "bg-teal-500/10"
  )
  const animation = animations.at(-1)!
  expect(animation.target).toBe(target)
  expect(animation.frames).toEqual([
    { boxShadow: "0 0 0 2px var(--xgui-orange)" },
    { boxShadow: "0 0 0 2px transparent" },
  ])
  expect(animation.options).toEqual({
    duration: 2_000,
    easing: "linear",
    fill: "forwards",
  })
}

describe("desktop-aligned message highlight", () => {
  it.each(["other", "me"] as const)(
    "only outlines the %s bubble and restarts without remounting its content",
    (role) => {
      const value = message(role)
      const bubble = (key?: number) => (
        <MemoryRouter>
          <MessageBubble {...props} message={value} highlightRequestKey={key} />
        </MemoryRouter>
      )
      const view = render(bubble())
      expect(animations).toHaveLength(0)
      view.rerender(bubble(1))
      const target = animations[0].target
      expectOutline(target)
      view.rerender(bubble(2))
      expect(animations).toHaveLength(2)
      expect(animations[0].cancel).toHaveBeenCalledOnce()
      expect(animations[1].target).toBe(target)
      expectOutline(target)
      view.rerender(bubble())
      expect(target).not.toHaveClass("ring-2")
      expect(animations[1].cancel).toHaveBeenCalledOnce()
    }
  )

  it("outlines system badges rather than the full row and responds to memoized prop changes", () => {
    const value = message("system")
    const bubble = (key?: number) => (
      <SystemMessageBadge
        currentUserId="me"
        mentionLabelResolver={props.mentionLabelResolver}
        message={value}
        highlightRequestKey={key}
      />
    )
    const view = render(bubble())
    expect(animations).toHaveLength(0)
    view.rerender(bubble(1))
    expectOutline(animations[0].target)
    expect(animations[0].target).toHaveAttribute("data-slot", "badge")
    view.rerender(bubble(2))
    expect(animations).toHaveLength(2)
    expect(animations[0].cancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(animations[1].cancel).toHaveBeenCalledOnce()
  })

  it("keeps the highlight on the image bubble without replacing its overflow and padding rules", () => {
    const value = {
      ...message(),
      body: { type: "image", fileId: "file" } as const,
    }
    render(
      <MemoryRouter>
        <MessageBubble {...props} message={value} highlightRequestKey={1} />
      </MemoryRouter>
    )
    const target = animations[0].target
    expectOutline(target)
    expect(target).toHaveClass("overflow-hidden", "p-0")
  })

  it("respects reduced motion with a static orange ring", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    const view = render(
      <MemoryRouter>
        <MessageBubble {...props} message={message()} highlightRequestKey={1} />
      </MemoryRouter>
    )
    expect(animations).toHaveLength(0)
    expect(view.container.querySelector(".ring-xgui-orange")).toHaveClass(
      "ring-2"
    )
  })
})
