import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type {
  ClientConversation,
  ClientMessage,
  ClientUser,
  ContactApp,
  ContactUser,
} from "@/lib/client-data-api"

describe("ConversationSidebar", () => {
  it("memoizes rows and updates only the row whose draft changed", () => {
    const conversations = [
      createAppConversation({ id: "first", name: "一" }),
      createAppConversation({ id: "second", name: "二" }),
    ]
    const renders = vi.fn()
    const props = {
      activeConversationId: "",
      appsById: new Map<string, ContactApp>(),
      contactsById: new Map<string, ContactUser>(),
      conversations,
      currentUser: createCurrentUser(),
      getLatestCachedMessage: () => undefined,
      onCreateGroup: vi.fn(),
      onRowRender: renders,
      onSelectConversation: vi.fn(),
      onSetConversationPinned: async () => undefined,
    }
    const { rerender } = render(
      <SidebarProvider>
        <ConversationSidebar {...props} drafts={{}} />
      </SidebarProvider>
    )
    expect(renders.mock.calls.map(([id]) => id)).toEqual(["first", "second"])
    renders.mockClear()
    rerender(
      <SidebarProvider>
        <ConversationSidebar {...props} drafts={{}} />
      </SidebarProvider>
    )
    expect(renders).not.toHaveBeenCalled()
    rerender(
      <SidebarProvider>
        <ConversationSidebar
          {...props}
          drafts={{
            first: {
              mentions: [],
              replyTarget: null,
              text: "草稿",
              updatedAt: 1,
            },
          }}
        />
      </SidebarProvider>
    )
    expect(renders.mock.calls.map(([id]) => id)).toEqual(["first"])
  })

  it("filters conversations by type", async () => {
    const user = userEvent.setup()
    const conversations = [
      createAppConversation({
        id: "direct",
        name: "联系人会话",
        type: "direct",
      }),
      createAppConversation({
        id: "app",
        lastMessageSeq: 1,
        name: "应用会话",
        type: "app",
        unreadCount: 1,
      }),
      createAppConversation({ id: "group", name: "群聊会话", type: "group" }),
      createAppConversation({
        id: "topic",
        lastMessageAt: new Date().toISOString(),
        lastMessageSeq: 1,
        name: "话题会话",
        topic: {
          archived: false,
          parentConversationId: "group",
          parentConversationName: "群聊会话",
          parentConversationType: "group",
          participating: true,
          sourceMessageId: "message-1",
          sourceMessageSeq: 1,
          sourceSender: {
            avatar: "",
            id: "user-2",
            name: "成员",
            type: "user",
          },
        },
        type: "topic",
        unreadCount: 1,
      }),
    ]
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={contactsFor(conversations)}
          conversations={conversations}
          currentUser={createCurrentUser()}
          drafts={{}}
          getLatestCachedMessage={(id) =>
            cachedMessagesFor(conversations, id).at(-1)
          }
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByText("联系人会话")).toBeInTheDocument()
    expect(screen.getByText("应用会话")).toBeInTheDocument()
    expect(screen.getByText("群聊会话")).toBeInTheDocument()
    expect(screen.getByText("话题会话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "未读" }))
    expect(screen.queryByText("联系人会话")).not.toBeInTheDocument()
    expect(screen.getByText("应用会话")).toBeInTheDocument()
    expect(screen.getByText("群聊会话")).toBeInTheDocument()
    expect(screen.getByText("话题会话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "单聊" }))
    expect(screen.getByText("联系人会话")).toBeInTheDocument()
    expect(screen.getByText("应用会话")).toBeInTheDocument()
    expect(screen.queryByText("群聊会话")).not.toBeInTheDocument()
    expect(screen.queryByText("话题会话")).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "群聊" }))
    expect(screen.getByText("群聊会话")).toBeInTheDocument()
    expect(screen.getByText("话题会话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "全部" }))
    expect(screen.getByText("联系人会话")).toBeInTheDocument()
    expect(screen.getByText("应用会话")).toBeInTheDocument()
    expect(screen.getByText("群聊会话")).toBeInTheDocument()
    expect(screen.getByText("话题会话")).toBeInTheDocument()
  })

  it("omits the sender in direct chats and shows it in group chats", () => {
    const conversations = [
      createAppConversation({
        id: "mine",
        lastMessageSender: {
          id: "user-1",
          name: "当前用户",
          nickname: "",
          type: "user",
        },
        lastMessageSummary: "我发送的消息",
        lastChoiceSeq: 0,
        name: "我的会话",
      }),
      createAppConversation({
        id: "direct-user",
        lastMessageSender: {
          id: "user-2",
          name: "张三",
          nickname: "小张",
          type: "user",
        },
        lastMessageSummary: "其他人的消息",
        lastChoiceSeq: 0,
        name: "用户私聊",
        type: "direct",
      }),
      createAppConversation({
        id: "app",
        lastMessageSender: {
          id: "app-1",
          name: "发布助手",
          nickname: "",
          type: "app",
        },
        lastMessageSummary: "应用消息",
        lastChoiceSeq: 0,
        name: "应用会话",
      }),
      createAppConversation({
        id: "group-user",
        lastMessageSender: {
          id: "user-2",
          name: "张三",
          nickname: "小张",
          type: "user",
        },
        lastMessageSummary: "群聊消息",
        lastChoiceSeq: 0,
        name: "用户群聊",
        type: "group",
      }),
      createAppConversation({
        id: "group-system",
        lastMessageSender: {
          id: "",
          name: "系统",
          nickname: "",
          type: "system",
        },
        lastMessageSummary: "张三加入群聊",
        lastChoiceSeq: 0,
        name: "系统会话",
        type: "group",
      }),
      createTopicConversationForSidebar({
        id: "app-topic",
        lastMessageSummary: "应用话题消息",
        parentConversationId: "app",
        parentConversationName: "应用会话",
        parentConversationType: "app",
      }),
      createTopicConversationForSidebar({
        id: "group-topic",
        lastMessageSummary: "群聊话题消息",
        parentConversationId: "group-user",
        parentConversationName: "用户群聊",
        parentConversationType: "group",
      }),
    ]

    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={contactsFor(conversations)}
          conversations={conversations}
          currentUser={createCurrentUser()}
          drafts={{}}
          getLatestCachedMessage={(id) =>
            cachedMessagesFor(conversations, id).at(-1)
          }
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByText("我发送的消息")).toBeInTheDocument()
    expect(screen.getByText("其他人的消息")).toBeInTheDocument()
    expect(screen.getByText("应用消息")).toBeInTheDocument()
    expect(screen.getByText("小张：群聊消息")).toBeInTheDocument()
    expect(screen.getByText("系统：张三加入群聊")).toBeInTheDocument()
    expect(screen.getByText("应用话题消息")).toBeInTheDocument()
    expect(screen.queryByText("小张：应用话题消息")).not.toBeInTheDocument()
    expect(screen.getByText("小张：群聊话题消息")).toBeInTheDocument()
  })

  it("uses only cached messages for the summary and group sender", () => {
    const conversation = createAppConversation({
      id: "group",
      lastMessageSender: {
        id: "app-1",
        name: "错误发送者",
        nickname: "",
        type: "app",
      },
      lastMessageSummary: "服务端摘要",
      name: "群聊",
      type: "group",
    })
    const cached = {
      body: { content: "缓存摘要", type: "text" },
      conversationId: "group",
      sender: { id: "user-2", type: "user" },
    } as ClientMessage
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={
            new Map([
              ["user-2", { name: "缓存用户", nickname: "小张" } as ContactUser],
            ])
          }
          conversations={[
            conversation,
            createAppConversation({
              id: "empty",
              lastMessageSummary: "不能回退",
            }),
          ]}
          currentUser={createCurrentUser()}
          drafts={{}}
          getLatestCachedMessage={(id) => (id === "group" ? cached : undefined)}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByText("小张：缓存摘要")).toBeInTheDocument()
    expect(screen.getByText("暂无消息")).toBeInTheDocument()
    expect(screen.queryByText("服务端摘要")).not.toBeInTheDocument()
    expect(screen.queryByText("不能回退")).not.toBeInTheDocument()
  })

  it("keeps mention and draft preview priority", () => {
    const mentioned = createAppConversation({
      id: "mentioned",
      lastMentionedSeq: 2,
      lastMessageSender: {
        id: "user-2",
        name: "张三",
        nickname: "小张",
        type: "user",
      },
      lastMessageSeq: 2,
      lastMessageSummary: "请看一下",
      lastChoiceSeq: 0,
      name: "有提醒",
    })
    const drafted = createAppConversation({
      id: "drafted",
      lastMessageSender: {
        id: "user-2",
        name: "张三",
        nickname: "小张",
        type: "user",
      },
      lastMessageSummary: "旧消息",
      lastChoiceSeq: 0,
      name: "有草稿",
    })
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={contactsFor([mentioned, drafted])}
          conversations={[mentioned, drafted]}
          currentUser={createCurrentUser()}
          getLatestCachedMessage={(id) =>
            cachedMessagesFor([mentioned, drafted], id).at(-1)
          }
          drafts={{
            drafted: {
              mentions: [],
              replyTarget: null,
              text: "尚未发送的内容",
              updatedAt: 1,
            },
            mentioned: {
              mentions: [],
              replyTarget: null,
              text: "不会覆盖 @ 提醒",
              updatedAt: 1,
            },
          }}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByText("[有人 @ 我]")).toBeInTheDocument()
    expect(screen.getByText("请看一下")).toBeInTheDocument()
    expect(screen.getByText("[草稿]")).toBeInTheDocument()
    expect(screen.getByText("尚未发送的内容")).toBeInTheDocument()
    expect(screen.queryByText("不会覆盖 @ 提醒")).not.toBeInTheDocument()
  })

  it("highlights the newest unread choice or mention without repeating the choice prefix", () => {
    const choice = createAppConversation({
      id: "choice",
      lastChoiceSeq: 5,
      lastMentionedSeq: 4,
      lastMessageSeq: 5,
      lastMessageSender: {
        id: "app-1",
        name: "茉莉",
        nickname: "",
        type: "app",
      },
      lastMessageSummary: "[选择] 请选择项目",
      name: "等待选择",
      type: "group",
    })
    const mention = createAppConversation({
      id: "mention",
      lastChoiceSeq: 4,
      lastMentionedSeq: 5,
      lastMessageSeq: 5,
      lastMessageSummary: "请确认",
      name: "等待确认",
    })
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={
            new Map([
              [
                "app-1",
                {
                  avatar: "",
                  creatorUserId: null,
                  description: "",
                  id: "app-1",
                  name: "茉莉",
                  online: true,
                  type: "app",
                } satisfies ContactApp,
              ],
            ])
          }
          contactsById={new Map()}
          conversations={[choice, mention]}
          currentUser={createCurrentUser()}
          drafts={{}}
          getLatestCachedMessage={(id) =>
            cachedMessagesFor([choice, mention], id).at(-1)
          }
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByText("[选择]")).toBeInTheDocument()
    expect(screen.getByText("茉莉：请选择项目")).toBeInTheDocument()
    expect(screen.getAllByText("[有人 @ 我]")).toHaveLength(1)
    expect(screen.queryByText("[选择] 请选择项目")).not.toBeInTheDocument()
  })

  it("pins an ordinary conversation from its context menu", async () => {
    const onSetConversationPinned = vi.fn().mockResolvedValue(undefined)
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId="conversation-app-1"
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[createAppConversation()]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={onSetConversationPinned}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("置顶对话"))

    await waitFor(() =>
      expect(onSetConversationPinned).toHaveBeenCalledWith(
        "conversation-app-1",
        true
      )
    )
  })

  it("does not show a pin action for the built-in assistant", async () => {
    const assistant = createAppConversation()
    assistant.pinned = true
    assistant.members = [
      {
        avatar: "",
        email: "",
        id: "00000000-0000-0000-0000-000000000001",
        name: "茉莉",
        nickname: "",
        phone: "",
        role: "member",
        type: "app",
      },
    ]
    assistant.name = "茉莉"
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId={assistant.id}
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[assistant]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByText("茉莉").closest("button")!)
    expect(await screen.findByText("消息免打扰")).toBeInTheDocument()
    expect(screen.queryByText("置顶对话")).not.toBeInTheDocument()
    expect(screen.queryByText("取消置顶")).not.toBeInTheDocument()
  })

  it("does not show a pin action for topics", async () => {
    const parent = createAppConversation({
      avatar: "/parent.webp",
      id: "parent",
      name: "父对话",
      type: "group",
    })
    const topic = createAppConversation({
      id: "topic",
      lastMessageAt: new Date().toISOString(),
      name: "子话题",
      topic: {
        archived: false,
        parentConversationId: parent.id,
        parentConversationName: parent.name,
        parentConversationType: "group",
        participating: true,
        sourceMessageId: "message-1",
        sourceMessageSeq: 1,
        sourceSender: {
          avatar: "/sender.webp",
          id: "user-2",
          name: "成员",
          type: "user",
        },
      },
      type: "topic",
    })
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[parent, topic]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    const topicButton = screen.getByText("子话题").closest("button")!
    const sourceAvatar = within(topicButton).getByLabelText("成员")
    expect(
      within(topicButton).queryByLabelText("父对话")
    ).not.toBeInTheDocument()
    expect(sourceAvatar.closest('[data-slot="avatar"]')).toHaveClass("size-8")

    fireEvent.contextMenu(topicButton)
    expect(await screen.findByText("消息免打扰")).toBeInTheDocument()
    expect(screen.queryByText("置顶对话")).not.toBeInTheDocument()
  })

  it("shows muted unread conversations as a dot and toggles mute", async () => {
    const onSetConversationMuted = vi.fn().mockResolvedValue(undefined)
    const conversation = createAppConversation({
      notificationMuted: true,
      unreadCount: 8,
    })
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[conversation]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationMuted={onSetConversationMuted}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    expect(screen.getByLabelText("消息免打扰")).toBeInTheDocument()
    expect(screen.getByLabelText("有未读消息")).toBeInTheDocument()
    expect(screen.queryByLabelText("8 条未读消息")).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("取消免打扰"))
    await waitFor(() =>
      expect(onSetConversationMuted).toHaveBeenCalledWith(
        "conversation-app-1",
        false
      )
    )
  })

  it("confirms before deleting a conversation", async () => {
    const onDismissConversation = vi.fn().mockResolvedValue(undefined)
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[createAppConversation()]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onCreateGroup={vi.fn()}
          onDismissConversation={onDismissConversation}
          onSelectConversation={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("删除对话"))
    expect(await screen.findByText("删除对话？")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "删除" }))

    await waitFor(() =>
      expect(onDismissConversation).toHaveBeenCalledWith("conversation-app-1")
    )
  })
})

function createAppConversation(
  overrides: Partial<ClientConversation> = {}
): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-17T00:00:00Z",
    id: "conversation-app-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSender: null,
    lastMessageSummary: "暂无消息",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 2,
    members: [],
    name: "智能助手",
    type: "app",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}

function contactsFor(conversations: ClientConversation[]) {
  return new Map(
    conversations.flatMap((conversation) => {
      const sender = conversation.lastMessageSender
      return sender?.type === "user"
        ? [[sender.id, sender as unknown as ContactUser] as const]
        : []
    })
  )
}

function cachedMessagesFor(
  conversations: ClientConversation[],
  conversationId: string
): ClientMessage[] {
  const conversation = conversations.find((item) => item.id === conversationId)
  if (!conversation?.lastMessageSummary) return []
  return [
    {
      body: { content: conversation.lastMessageSummary, type: "text" },
      conversationId,
      sender: conversation.lastMessageSender ?? {
        id: "user-1",
        type: "user",
      },
    } as ClientMessage,
  ]
}

function createCurrentUser(): ClientUser {
  return {
    avatar: "",
    createdAt: "2026-07-17T00:00:00Z",
    email: "me@example.com",
    id: "user-1",
    lastOnlineAt: null,
    name: "当前用户",
    nickname: "",
    phone: "",
    status: "active",
  }
}

function createTopicConversationForSidebar({
  id,
  lastMessageSummary,
  parentConversationId,
  parentConversationName,
  parentConversationType,
}: {
  id: string
  lastMessageSummary: string
  parentConversationId: string
  parentConversationName: string
  parentConversationType: "direct" | "app" | "group"
}) {
  return createAppConversation({
    id,
    lastMessageAt: new Date().toISOString(),
    lastMessageSender: {
      id: "user-2",
      name: "张三",
      nickname: "小张",
      type: "user",
    },
    lastMessageSummary,
    name: `${parentConversationName}的话题`,
    topic: {
      archived: false,
      parentConversationId,
      parentConversationName,
      parentConversationType,
      participating: true,
      sourceMessageId: `source-${id}`,
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "",
        id: "user-2",
        name: "张三",
        type: "user",
      },
    },
    type: "topic",
  })
}
