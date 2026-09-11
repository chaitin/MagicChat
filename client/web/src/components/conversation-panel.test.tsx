import * as React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import {
  ConversationPanel,
  type ConversationPanelMessage,
  type ConversationPanelReplyTarget,
} from "@/components/conversation-panel"
import type { ClientConversation } from "@/lib/client-data-api"
import {
  ClientDataContext,
  type ClientDataContextValue,
} from "@/lib/client-data-context"

describe("ConversationPanel", () => {
  it("shows a non-empty announcement only for a group conversation", () => {
    const props = {
      currentUserId: "user-1",
      draft: "",
      historyError: null,
      historyLoading: false,
      historyLoadingBefore: false,
      messages: [],
      onCancelReply: vi.fn(),
      onDraftChange: vi.fn(),
      onLoadBeforeMessages: vi.fn(),
      onReplyToMessage: vi.fn(),
      onRevokeMessage: vi.fn(),
      onRichTextModeChange: vi.fn(),
      onSendFile: async () => null,
      onSendImage: async () => null,
      onSendMessage: vi.fn(),
      onSendVoice: async () => null,
      replyTarget: null,
      richTextMode: false,
      sending: false,
    }
    const group = {
      ...createConversation("group-1"),
      announcement: "群公告内容",
      type: "group" as const,
    }
    const { rerender } = render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel {...props} conversation={group} />
        </ClientDataContext.Provider>
      </MemoryRouter>
    )
    expect(screen.getByRole("region", { name: "群公告" })).toHaveTextContent(
      "群公告内容"
    )

    rerender(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            {...props}
            conversation={{ ...group, type: "direct" }}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>
    )
    expect(screen.queryByRole("region", { name: "群公告" })).toBeNull()
  })

  it("treats a history header as the first message instead of showing an empty state", () => {
    render(
      <ConversationPanel
        conversation={createConversation("topic-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyHeader={<div>话题来源消息</div>}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    )

    expect(screen.getByText("话题来源消息")).toBeInTheDocument()
    expect(screen.queryByTestId("conversation-history-empty")).toBeNull()
    expect(screen.queryByText("暂无消息")).toBeNull()
  })

  it("shows a closed-topic system message without a locked composer footer", () => {
    render(
      <ConversationPanel
        conversation={createConversation("topic-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[
          {
            author: "系统",
            avatar: "",
            body: {
              actor: { displayName: "Alice", id: "user-1" },
              event: "topic_closed",
              type: "system_event",
            },
            canRevoke: false,
            createdAt: "2026-07-20T12:00:00Z",
            delegatedByName: "",
            id: "message-1",
            mentionTarget: null,
            reactionVersion: 0,
            reactions: [],
            role: "system",
            senderAppId: null,
            senderAppProfile: null,
            senderUserId: null,
            time: "12:00",
          },
        ]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        readOnly
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    )

    expect(screen.getByText("Alice 已将话题关闭")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("输入消息")).not.toBeInTheDocument()
    expect(
      screen.queryByText("话题已归档，无法继续发言")
    ).not.toBeInTheDocument()
  })

  it("keeps retained history visible but disables message mutations when access is revoked", async () => {
    const onRevokeMessage = vi.fn()
    const onSetMessageReaction = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ClientDataContext.Provider value={createClientDataValue()}>
          <ConversationPanel
            conversation={{
              ...createConversation("conversation-1"),
              canSend: false,
            }}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[
              {
                author: "我",
                avatar: "",
                body: { content: "保留的历史消息", type: "text" },
                canRevoke: true,
                createdAt: "2026-07-20T12:00:00Z",
                delegatedByName: "",
                id: "message-1",
                mentionTarget: null,
                reactionVersion: 1,
                reactions: [
                  {
                    count: 1,
                    reactedByMe: true,
                    text: "👍",
                    users: [],
                  },
                ],
                role: "me",
                senderAppId: null,
                senderAppProfile: null,
                senderUserId: "user-1",
                time: "12:00",
              },
            ]}
            onCancelReply={vi.fn()}
            onDraftChange={vi.fn()}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={onRevokeMessage}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            onSetMessageReaction={onSetMessageReaction}
            readOnly
            readOnlyReason="你当前无权直接使用此应用"
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>
    )

    expect(screen.getByText("保留的历史消息")).toBeVisible()
    expect(screen.queryByPlaceholderText("输入消息")).not.toBeInTheDocument()
    const reaction = screen.getByRole("button", { name: "移除表情 👍" })
    expect(reaction).toBeDisabled()
    fireEvent.click(reaction)
    expect(onSetMessageReaction).not.toHaveBeenCalled()

    const messageActionTrigger = screen
      .getByText("保留的历史消息")
      .closest("[data-message-action-trigger]")
    expect(messageActionTrigger).not.toBeNull()
    fireEvent.contextMenu(messageActionTrigger!)
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "撤回" })
      ).not.toBeInTheDocument()
    )
    expect(onRevokeMessage).not.toHaveBeenCalled()
  })

  it("refocuses the composer textarea when a reply target is selected", async () => {
    const { rerender } = render(
      <ConversationPanel
        conversation={createConversation("conversation-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    )

    const composer = screen.getByPlaceholderText("输入消息")
    const sendButton = screen.getByRole("button", { name: "发送消息" })

    await waitFor(() => expect(composer).toHaveFocus())
    sendButton.focus()
    expect(sendButton).toHaveFocus()

    rerender(
      <ConversationPanel
        conversation={createConversation("conversation-1")}
        currentUserId="user-1"
        draft=""
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={vi.fn()}
        replyTarget={{
          author: "李四",
          id: "message-1",
          summary: "收到",
        }}
        richTextMode={false}
        sending={false}
      />
    )

    await waitFor(() => expect(composer).toHaveFocus())
  })

  it.each([
    {
      content: "重新发送普通文字",
      expectedPlaceholder: "输入消息",
      type: "text" as const,
    },
    {
      content: "**重新发送 Markdown**",
      expectedPlaceholder: "输入 Markdown 消息",
      type: "markdown" as const,
    },
  ])(
    "restores an own revoked $type message to the matching composer mode",
    async ({ content, expectedPlaceholder, type }) => {
      const user = userEvent.setup()
      renderReeditRevokedMessage({ content, role: "me", type })

      const reedit = screen.getByRole("button", { name: "重新编辑" })
      expect(reedit.parentElement).toHaveTextContent("重新编辑已撤回的消息")
      expect(reedit).toHaveClass(
        "cursor-pointer",
        "text-(--weui-link)",
        "hover:text-(--weui-link)"
      )

      await user.click(reedit)

      const composer = screen.getByDisplayValue(content)
      expect(composer).toHaveAttribute("placeholder", expectedPlaceholder)
      expect(screen.queryByTestId("conversation-reply-preview")).toBeNull()
      await waitFor(() => {
        expect(composer).toHaveFocus()
        expect((composer as HTMLTextAreaElement).selectionStart).toBe(
          content.length
        )
        expect((composer as HTMLTextAreaElement).selectionEnd).toBe(
          content.length
        )
      })
    }
  )

  it("does not offer re-editing for another user's revoked message", () => {
    renderReeditRevokedMessage({
      content: "不应恢复的文字",
      role: "other",
      type: "text",
    })

    expect(
      screen.queryByRole("button", { name: "重新编辑" })
    ).not.toBeInTheDocument()
    expect(screen.getByText("该消息已被撤回")).toBeInTheDocument()
  })

  it("does not offer re-editing while another message is being sent", () => {
    renderReeditRevokedMessage({
      content: "发送完成前不应恢复的文字",
      role: "me",
      sending: true,
      type: "text",
    })

    expect(
      screen.queryByRole("button", { name: "重新编辑" })
    ).not.toBeInTheDocument()
    expect(screen.getByText("该消息已被撤回")).toBeInTheDocument()
  })

  it("does not send when Enter belongs to an IME interaction", () => {
    const onSendMessage = vi.fn()

    render(
      <ConversationPanel
        conversation={createConversation("conversation-1")}
        currentUserId="user-1"
        draft="nihao"
        historyError={null}
        historyLoading={false}
        historyLoadingBefore={false}
        messages={[]}
        onCancelReply={vi.fn()}
        onDraftChange={vi.fn()}
        onLoadBeforeMessages={vi.fn()}
        onReplyToMessage={vi.fn()}
        onRevokeMessage={vi.fn()}
        onRichTextModeChange={vi.fn()}
        onSendFile={async () => null}
        onSendImage={async () => null}
        onSendVoice={async () => null}
        onSendMessage={onSendMessage}
        replyTarget={null}
        richTextMode={false}
        sending={false}
      />
    )

    const composer = screen.getByPlaceholderText("输入消息")
    const compositionKeyDownNotCanceled = fireEvent.keyDown(composer, {
      code: "Enter",
      isComposing: true,
      key: "Enter",
    })
    const processKeyDownNotCanceled = fireEvent.keyDown(composer, {
      code: "Enter",
      key: "Enter",
      keyCode: 229,
    })

    expect(compositionKeyDownNotCanceled).toBe(true)
    expect(processKeyDownNotCanceled).toBe(true)
    expect(onSendMessage).not.toHaveBeenCalled()
  })

  it("opens the app profile popover from an app message avatar", async () => {
    const user = userEvent.setup()
    const openAppConversation = vi.fn()

    render(
      <MemoryRouter>
        <ClientDataContext.Provider
          value={createClientDataValue({
            contactApps: [
              {
                avatar: "/assets/apps/assistant.webp",
                creatorUserId: null,
                description: "企业助手",
                id: "app-1",
                name: "智能助手",
                online: true,
                type: "app",
              },
            ],
            openAppConversation,
          })}
        >
          <ConversationPanel
            conversation={createConversation("conversation-1")}
            currentUserId="user-1"
            draft=""
            historyError={null}
            historyLoading={false}
            historyLoadingBefore={false}
            messages={[
              createAppPanelMessage({
                appId: "app-1",
                avatar: "",
                author: "智能助手",
              }),
            ]}
            onCancelReply={vi.fn()}
            onDraftChange={vi.fn()}
            onLoadBeforeMessages={vi.fn()}
            onReplyToMessage={vi.fn()}
            onRevokeMessage={vi.fn()}
            onRichTextModeChange={vi.fn()}
            onSendFile={async () => null}
            onSendImage={async () => null}
            onSendVoice={async () => null}
            onSendMessage={vi.fn()}
            replyTarget={null}
            richTextMode={false}
            sending={false}
          />
        </ClientDataContext.Provider>
      </MemoryRouter>
    )

    const appProfileTrigger = screen.getByRole("button", {
      name: "智能助手资料",
    })

    await user.click(appProfileTrigger)

    expect(await screen.findByText("企业助手")).toBeInTheDocument()
    expect(screen.getByText("类型")).toBeInTheDocument()
    expect(screen.getByText("应用")).toBeInTheDocument()
    expect(screen.getByText("状态")).toBeInTheDocument()
    expect(screen.getByText("在线")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发消息" })).toBeInTheDocument()
  })
})

function createConversation(id: string): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-09T00:00:00Z",
    id,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSender: null,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    members: [],
    name: "测试会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
  }
}

function renderReeditRevokedMessage({
  content,
  role,
  sending = false,
  type,
}: {
  content: string
  role: "me" | "other"
  sending?: boolean
  type: "markdown" | "text"
}) {
  return render(
    <MemoryRouter>
      <ClientDataContext.Provider value={createClientDataValue()}>
        <ReeditRevokedMessageHarness
          content={content}
          role={role}
          sending={sending}
          type={type}
        />
      </ClientDataContext.Provider>
    </MemoryRouter>
  )
}

function ReeditRevokedMessageHarness({
  content,
  role,
  sending,
  type,
}: {
  content: string
  role: "me" | "other"
  sending: boolean
  type: "markdown" | "text"
}) {
  const [draft, setDraft] = React.useState("现有草稿")
  const [replyTarget, setReplyTarget] =
    React.useState<ConversationPanelReplyTarget | null>({
      author: "李四",
      id: "message-reply",
      summary: "上一条消息",
    })
  const [richTextMode, setRichTextMode] = React.useState(type === "text")

  return (
    <ConversationPanel
      conversation={createConversation("conversation-1")}
      currentUserId="user-1"
      draft={draft}
      historyError={null}
      historyLoading={false}
      historyLoadingBefore={false}
      messages={[
        {
          author: role === "me" ? "我" : "李四",
          avatar: "",
          body: {
            editableBody: { content, type },
            type: "revoked",
          },
          canRevoke: false,
          createdAt: "2026-07-30T10:00:00Z",
          delegatedByName: "",
          id: "message-revoked",
          mentionTarget: null,
          reactionVersion: 0,
          reactions: [],
          role,
          senderAppId: null,
          senderAppProfile: null,
          senderUserId: role === "me" ? "user-1" : "user-2",
          time: "10:00",
        },
      ]}
      onCancelReply={() => setReplyTarget(null)}
      onDraftChange={(nextDraft) => setDraft(nextDraft)}
      onLoadBeforeMessages={vi.fn()}
      onReplyToMessage={vi.fn()}
      onRevokeMessage={vi.fn()}
      onRichTextModeChange={setRichTextMode}
      onSendFile={async () => null}
      onSendImage={async () => null}
      onSendVoice={async () => null}
      onSendMessage={vi.fn()}
      replyTarget={replyTarget}
      richTextMode={richTextMode}
      sending={sending}
    />
  )
}

function createAppPanelMessage({
  appId,
  author,
  avatar,
}: {
  appId: string
  author: string
  avatar: string
}): ConversationPanelMessage {
  return {
    author,
    avatar,
    body: {
      content: "应用消息",
      type: "text",
    },
    canRevoke: false,
    createdAt: "2026-07-20T10:00:00Z",
    delegatedByName: "",
    id: "message-1",
    mentionTarget: null,
    reactionVersion: 0,
    reactions: [],
    role: "other",
    senderAppId: appId,
    senderAppProfile: {
      avatar,
      description: "",
      id: appId,
      name: author,
      online: false,
    },
    senderUserId: null,
    time: "10:00",
  }
}

function createClientDataValue(
  overrides: Partial<ClientDataContextValue> = {}
): ClientDataContextValue {
  const value: Partial<ClientDataContextValue> = {
    contactApps: [],
    contactGroups: [],
    contacts: [],
    contactsError: null,
    contactsLoading: false,
    contactsRefreshing: false,
    conversations: [],
    me: {
      avatar: "",
      createdAt: "2026-07-09T00:00:00Z",
      email: "me@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "张三",
      nickname: "",
      phone: "",
      status: "active",
    },
    meError: null,
    meLoading: false,
    meRefreshing: false,
    openAppConversation: vi.fn(),
    openDirectConversation: vi.fn(),
    ...overrides,
  }

  return value as ClientDataContextValue
}
