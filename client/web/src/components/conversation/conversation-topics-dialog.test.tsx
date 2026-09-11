import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationTopicsDialog } from "@/components/conversation/conversation-topics-dialog"
import type { ClientConversation } from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  listConversationTopics: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    listConversationTopics: mocks.listConversationTopics,
  }
})

describe("ConversationTopicsDialog", () => {
  beforeEach(() => {
    mocks.listConversationTopics.mockReset()
    mocks.listConversationTopics.mockResolvedValue({
      nextCursor: null,
      topics: [
        createTopic("topic-active", {
          name: "发布计划讨论",
          participating: true,
        }),
        createTopic("topic-archived", {
          archived: true,
          name: "历史部署问题",
        }),
      ],
    })
  })

  it("lists visible topics and opens the selected topic", async () => {
    const user = userEvent.setup()
    const onOpenTopic = vi.fn()
    render(
      <ConversationTopicsDialog
        conversation={createConversation("group")}
        onOpenTopic={onOpenTopic}
      />
    )

    await user.click(screen.getByRole("button", { name: "话题列表" }))

    expect(await screen.findByText("发布计划讨论")).toBeVisible()
    expect(screen.getAllByText("最后一条回复")).toHaveLength(2)
    expect(screen.getByText("历史部署问题")).toBeVisible()
    expect(screen.getByText("已参与")).toBeVisible()
    expect(screen.getByText("已关闭")).toBeVisible()
    expect(mocks.listConversationTopics).toHaveBeenCalledWith(
      "conversation-1",
      { cursor: undefined, limit: 50 }
    )

    await user.click(screen.getByText("历史部署问题"))
    expect(onOpenTopic).toHaveBeenCalledWith("topic-archived")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("appends another page without replacing existing topics", async () => {
    const user = userEvent.setup()
    mocks.listConversationTopics
      .mockReset()
      .mockResolvedValueOnce({
        nextCursor: "cursor-2",
        topics: [createTopic("topic-first", { name: "第一页话题" })],
      })
      .mockResolvedValueOnce({
        nextCursor: null,
        topics: [createTopic("topic-second", { name: "第二页话题" })],
      })
    render(
      <ConversationTopicsDialog
        conversation={createConversation("group")}
        onOpenTopic={vi.fn()}
      />
    )

    await user.click(screen.getByRole("button", { name: "话题列表" }))
    await screen.findByText("第一页话题")
    await user.click(screen.getByRole("button", { name: "加载更多" }))

    expect(await screen.findByText("第二页话题")).toBeVisible()
    expect(screen.getByText("第一页话题")).toBeVisible()
    expect(mocks.listConversationTopics).toHaveBeenLastCalledWith(
      "conversation-1",
      { cursor: "cursor-2", limit: 50 }
    )
  })

  it("does not render the button for a topic conversation", () => {
    render(
      <ConversationTopicsDialog
        conversation={createConversation("topic")}
        onOpenTopic={vi.fn()}
      />
    )

    expect(
      screen.queryByRole("button", { name: "话题列表" })
    ).not.toBeInTheDocument()
  })
})

function createConversation(
  type: ClientConversation["type"]
): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-08-18T10:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSender: null,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    name: "产品讨论",
    type,
    unreadCount: 0,
    visibility: "private",
  }
}

function createTopic(
  id: string,
  options: {
    archived?: boolean
    name: string
    participating?: boolean
  }
): ClientConversation {
  return {
    ...createConversation("topic"),
    createdAt: "2026-08-18T10:00:00Z",
    id,
    lastMessageAt: "2026-08-18T10:30:00Z",
    lastMessageSummary: "最后一条回复",
    name: options.name,
    topic: {
      archived: Boolean(options.archived),
      parentConversationId: "conversation-1",
      parentConversationName: "产品讨论",
      parentConversationType: "group",
      participating: Boolean(options.participating),
      sourceMessageId: `source-${id}`,
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "/avatars/alice.webp",
        id: "user-1",
        name: "Alice",
        type: "user",
      },
    },
  }
}
