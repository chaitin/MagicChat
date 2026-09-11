import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationAttachmentsDialog } from "@/components/conversation/conversation-attachments-dialog"
import type {
  ClientConversation,
  ClientConversationAttachment,
} from "@/lib/client-data-api"

const mocks = vi.hoisted(() => ({
  listConversationAttachments: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    listConversationAttachments: mocks.listConversationAttachments,
  }
})

describe("ConversationAttachmentsDialog", () => {
  beforeEach(() => {
    mocks.listConversationAttachments.mockReset()
    mocks.listConversationAttachments.mockResolvedValue({
      attachments: [createAttachment("message-1", "设计文档.pdf")],
      nextCursor: null,
    })
  })

  it("opens from the enabled folder button and lists attachments", async () => {
    const user = userEvent.setup()
    render(
      <ConversationAttachmentsDialog
        conversation={createConversation("group")}
      />
    )

    const trigger = screen.getByRole("button", { name: "历史附件" })
    expect(trigger).toBeEnabled()
    await user.click(trigger)

    expect(await screen.findByText("设计文档.pdf")).toBeVisible()
    expect(screen.getByText("1 KB")).toBeVisible()
    expect(mocks.listConversationAttachments).toHaveBeenCalledWith(
      "conversation-1",
      { cursor: undefined, limit: 50 }
    )
  })

  it("appends the next attachment page", async () => {
    const user = userEvent.setup()
    mocks.listConversationAttachments
      .mockReset()
      .mockResolvedValueOnce({
        attachments: [createAttachment("message-2", "新文档.pdf")],
        nextCursor: "12",
      })
      .mockResolvedValueOnce({
        attachments: [createAttachment("message-1", "旧文档.pdf")],
        nextCursor: null,
      })
    render(
      <ConversationAttachmentsDialog
        conversation={createConversation("direct")}
      />
    )

    await user.click(screen.getByRole("button", { name: "历史附件" }))
    await screen.findByText("新文档.pdf")
    await user.click(screen.getByRole("button", { name: "加载更多" }))

    expect(await screen.findByText("旧文档.pdf")).toBeVisible()
    expect(screen.getByText("新文档.pdf")).toBeVisible()
    expect(mocks.listConversationAttachments).toHaveBeenLastCalledWith(
      "conversation-1",
      { cursor: "12", limit: 50 }
    )
  })

  it("resets the load-more state after closing and reopening", async () => {
    const user = userEvent.setup()
    let resolveLoadMore:
      | ((value: {
          attachments: ClientConversationAttachment[]
          nextCursor: string | null
        }) => void)
      | undefined
    const pendingLoadMore = new Promise<{
      attachments: ClientConversationAttachment[]
      nextCursor: string | null
    }>((resolve) => {
      resolveLoadMore = resolve
    })
    mocks.listConversationAttachments
      .mockReset()
      .mockResolvedValueOnce({
        attachments: [createAttachment("message-2", "第一页.pdf")],
        nextCursor: "12",
      })
      .mockReturnValueOnce(pendingLoadMore)
      .mockResolvedValueOnce({
        attachments: [createAttachment("message-3", "重新打开.pdf")],
        nextCursor: "8",
      })
    render(
      <ConversationAttachmentsDialog
        conversation={createConversation("group")}
      />
    )

    await user.click(screen.getByRole("button", { name: "历史附件" }))
    await screen.findByText("第一页.pdf")
    await user.click(screen.getByRole("button", { name: "加载更多" }))
    await waitFor(() =>
      expect(mocks.listConversationAttachments).toHaveBeenCalledTimes(2)
    )
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "历史附件" }))
    await screen.findByText("重新打开.pdf")
    expect(screen.getByRole("button", { name: "加载更多" })).toBeEnabled()

    resolveLoadMore?.({ attachments: [], nextCursor: null })
  })

  it("does not render for a topic conversation", () => {
    render(
      <ConversationAttachmentsDialog
        conversation={createConversation("topic")}
      />
    )

    expect(
      screen.queryByRole("button", { name: "历史附件" })
    ).not.toBeInTheDocument()
  })
})

function createAttachment(
  messageId: string,
  name: string
): ClientConversationAttachment {
  return {
    createdAt: "2026-08-19T10:00:00Z",
    file: { fileId: `file-${messageId}`, name, sizeBytes: 1024, type: "file" },
    messageId,
    seq: 12,
  }
}

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
