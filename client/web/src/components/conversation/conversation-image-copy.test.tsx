import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConversationPanel,
  type ConversationPanelMessage,
} from "@/components/conversation-panel"
import type {
  ClientConversation,
  ClientImageMessageBody,
} from "@/lib/client-data-api"
import {
  ClientDataContext,
  type ClientDataContextValue,
} from "@/lib/client-data-context"

const mocks = vi.hoisted(() => ({
  readTemporaryFileURLs: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()

  return {
    ...actual,
    readTemporaryFileURLs: mocks.readTemporaryFileURLs,
  }
})

describe("conversation image copy", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.readTemporaryFileURLs.mockResolvedValue([
      {
        expiresAt: "2026-07-17T12:00:00Z",
        fileId: "file-1",
        url: "https://example.com/image.png",
      },
    ])
  })

  it("omits copy from the image context menu", async () => {
    renderImageConversation()

    await openImageMessageActionMenu()
    await screen.findByRole("menuitem", { name: "回复" })
    expect(
      screen.queryByRole("menuitem", { name: "复制" })
    ).not.toBeInTheDocument()
  })

  it("omits copy from the image hover menu", async () => {
    const user = userEvent.setup()
    renderImageConversation()

    const image = await screen.findByRole("button", { name: "预览图片" })
    const messageRow = image.closest<HTMLElement>(
      "[data-conversation-message-id]"
    )
    expect(messageRow).not.toBeNull()
    await user.click(
      within(messageRow!).getByRole("button", { name: "更多操作" })
    )
    await screen.findByRole("menuitem", { name: "回复" })
    expect(
      screen.queryByRole("menuitem", { name: "复制" })
    ).not.toBeInTheDocument()
  })

  it("renders a markdown caption below the image", async () => {
    renderImageConversation({
      caption: "**图片说明**",
      captionType: "markdown",
    })

    const image = await screen.findByRole("button", { name: "预览图片" })
    const caption = screen.getByText("图片说明")
    expect(caption.tagName).toBe("STRONG")
    expect(image).toHaveClass("rounded-t-sm")
    expect(image).not.toHaveClass("rounded-sm")
  })

  it("keeps all image corners rounded without a caption", async () => {
    renderImageConversation()

    const image = await screen.findByRole("button", { name: "预览图片" })

    expect(image).toHaveClass("rounded-sm")
    expect(image).not.toHaveClass("rounded-t-sm")
  })

  it("constrains a long caption to the image thumbnail width", async () => {
    renderImageConversation({
      caption:
        "一段足够长的图片说明，它应该在图片宽度内换行，而不是把图片气泡撑宽。",
      height: 200,
      width: 800,
    })

    const image = await screen.findByRole("button", { name: "预览图片" })
    const imageMessageBody = image.closest<HTMLElement>(
      '[data-slot="image-message-body"]'
    )

    expect(imageMessageBody).not.toBeNull()
    expect(imageMessageBody).toHaveStyle({ width: "320px" })
    expect(imageMessageBody).toHaveClass("max-w-[65vw]")
  })
})

function renderImageConversation(
  imageOverrides: Partial<ClientImageMessageBody> = {}
) {
  return render(
    <MemoryRouter>
      <ClientDataContext.Provider value={createClientDataValue()}>
        <ConversationPanel
          conversation={createConversation()}
          currentUserId="user-1"
          draft=""
          historyError={null}
          historyLoading={false}
          historyLoadingBefore={false}
          messages={[createImageMessage(imageOverrides)]}
          onCancelReply={vi.fn()}
          onDraftChange={vi.fn()}
          onLoadBeforeMessages={vi.fn()}
          onReplyToMessage={vi.fn()}
          onRevokeMessage={vi.fn()}
          onRichTextModeChange={vi.fn()}
          onSendFile={async () => null}
          onSendImage={async () => null}
          onSendMessage={vi.fn()}
          onSendVoice={async () => null}
          replyTarget={null}
          richTextMode={false}
          sending={false}
        />
      </ClientDataContext.Provider>
    </MemoryRouter>
  )
}

async function openImageMessageActionMenu() {
  const image = await screen.findByRole("button", { name: "预览图片" })
  const messageActionTrigger = image.closest("[data-message-action-trigger]")
  if (!messageActionTrigger) {
    throw new Error("missing message action trigger")
  }

  fireEvent.contextMenu(messageActionTrigger)
}

function createImageMessage(
  imageOverrides: Partial<ClientImageMessageBody> = {}
): ConversationPanelMessage {
  return {
    author: "Alice",
    avatar: "",
    body: {
      fileId: "file-1",
      height: 120,
      type: "image",
      width: 160,
      ...imageOverrides,
    },
    canRevoke: false,
    createdAt: "2026-07-17T10:00:00Z",
    delegatedByName: "",
    id: "message-image-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "other",
    senderAppId: null,
    senderAppProfile: null,
    senderUserId: "user-2",
    time: "10:00",
  }
}

function createConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-17T10:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 1,
    lastMessageSender: null,
    lastMessageSummary: "[图片]",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 1,
    memberCount: 2,
    name: "测试会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}

function createClientDataValue(): ClientDataContextValue {
  return {
    contacts: [],
    me: {
      avatar: "",
      createdAt: "2026-07-17T10:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "我",
      nickname: "",
      phone: "",
      status: "active",
    },
    openDirectConversation: vi.fn(),
  } as unknown as ClientDataContextValue
}
