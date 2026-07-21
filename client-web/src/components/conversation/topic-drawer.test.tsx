import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import { TopicSourceBanner } from "@/components/conversation/topic-drawer"
import type { ClientTopicSourceMessage } from "@/lib/client-data-api"

vi.mock("@/components/user-profile-popover", () => ({
  UserProfilePopover: ({ children }: { children: ReactNode }) => children,
}))

describe("TopicSourceBanner", () => {
  it("renders the preserved source body instead of reducing it to its summary", () => {
    const sourceMessage: ClientTopicSourceMessage = {
      body: { content: "完整来源消息", type: "text" },
      createdAt: "2026-07-20T04:00:00Z",
      id: "message-1",
      revokedAt: null,
      sender: {
        avatar: "/avatars/alice.webp",
        id: "user-1",
        name: "Alice",
        type: "user",
      },
      seq: 8,
      summary: "不同的摘要",
    }

    render(
      <TopicSourceBanner currentUserId="user-2" sourceMessage={sourceMessage} />
    )

    expect(screen.getByText("完整来源消息")).toBeInTheDocument()
    expect(screen.queryByText("不同的摘要")).not.toBeInTheDocument()
  })

  it("renders and updates reactions on the source message", async () => {
    const onSetReaction = vi.fn().mockResolvedValue(undefined)
    render(
      <TopicSourceBanner
        currentUserId="user-2"
        onSetReaction={onSetReaction}
        reactions={[
          {
            count: 2,
            reactedByMe: true,
            text: "👍",
            users: [
              { id: "user-1", name: "Alice" },
              { id: "user-2", name: "Bob" },
            ],
          },
        ]}
        sourceMessage={createSourceMessage()}
      />
    )

    const reactionChip = screen.getByRole("button", {
      name: "移除表情 👍",
    })
    const addButton = screen.getByRole("button", { name: "添加表情" })
    const bubbleLine = addButton.closest('[data-slot="message-bubble-line"]')
    expect(bubbleLine).toContainElement(
      screen.getByTestId("topic-source-message-bubble")
    )
    expect(
      screen.getByTestId("topic-source-message-bubble")
    ).toContainElement(reactionChip)

    fireEvent.click(reactionChip)
    await waitFor(() => expect(onSetReaction).toHaveBeenCalledWith("👍", false))
    expect(screen.getByRole("button", { name: "添加表情" })).toBeInTheDocument()
  })
})

function createSourceMessage(): ClientTopicSourceMessage {
  return {
    body: { content: "完整来源消息", type: "text" },
    createdAt: "2026-07-20T04:00:00Z",
    id: "message-1",
    revokedAt: null,
    sender: {
      avatar: "/avatars/alice.webp",
      id: "user-1",
      name: "Alice",
      type: "user",
    },
    seq: 8,
    summary: "不同的摘要",
  }
}
