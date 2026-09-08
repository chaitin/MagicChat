import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConversationSidebar } from "@/components/conversation/conversation-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { ClientConversation, ClientUser } from "@/lib/client-data-api"

vi.mock("@/components/locale-provider", async () => {
  const { createElement, Fragment } = await import("react")
  const { translate } = await import("@/lib/i18n")
  return {
    LocaleProvider: ({ children }: { children: React.ReactNode }) =>
      createElement(Fragment, null, children),
    useLocale: () => ({
      fontScale: "normal",
      locale: "zh-CN",
      t: (key: string, params?: Record<string, string | number>) =>
        translate("zh-CN", key as never, params),
    }),
  }
})

describe("ConversationSidebar", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("显示桌面端完整搜索入口和筛选栏", () => {
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
          onSelectConversation={vi.fn()}
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    expect(screen.getByRole("button", { name: "搜索消息、联系人、会话" })).toBeInTheDocument()
    expect(screen.getByRole("tablist", { name: "会话类型" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "搜索消息" })).not.toBeInTheDocument()
    const header = screen
      .getByRole("heading", { name: "消息" })
      .closest("[data-slot='sidebar-header']")

    expect(header).toHaveClass("conversation-sidebar-header-surface")
    expect(header).toHaveAttribute("data-desktop-drag-region", "true")
  })

  it("从新建菜单触发添加好友", async () => {
    const user = userEvent.setup()
    const onAddFriend = vi.fn()
    render(
      <SidebarProvider>
        <ConversationSidebar
          activeConversationId=""
          appsById={new Map()}
          contactsById={new Map()}
          conversations={[]}
          currentUser={createCurrentUser()}
          drafts={{}}
          onAddFriend={onAddFriend}
          onCreateGroup={vi.fn()}
          onSelectConversation={vi.fn()}
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    await user.click(screen.getByRole("button", { name: "新建 Agent" }))
    const addFriendMenuItem = await screen.findByRole("menuitem", { name: "添加好友" })
    expect(addFriendMenuItem.querySelector("svg")).not.toBeInTheDocument()

    await user.click(addFriendMenuItem)
    expect(onAddFriend).toHaveBeenCalledOnce()
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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={onSetConversationPinned}
        />
      </SidebarProvider>,
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("置顶对话"))

    await waitFor(() =>
      expect(onSetConversationPinned).toHaveBeenCalledWith("conversation-app-1", true),
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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    fireEvent.contextMenu(screen.getByText("茉莉").closest("button")!)
    expect(await screen.findByText("消息免打扰")).toBeInTheDocument()
    expect(screen.queryByText("置顶对话")).not.toBeInTheDocument()
    expect(screen.queryByText("取消置顶")).not.toBeInTheDocument()
  })

  it("mutes an ordinary conversation from its context menu", async () => {
    const onSetConversationMuted = vi.fn().mockResolvedValue(undefined)
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
          onSetConversationMuted={onSetConversationMuted}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("消息免打扰"))

    await waitFor(() =>
      expect(onSetConversationMuted).toHaveBeenCalledWith("conversation-app-1", true),
    )
  })

  it("confirms before dismissing a conversation", async () => {
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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    fireEvent.contextMenu(screen.getByText("智能助手").closest("button")!)
    fireEvent.click(await screen.findByText("删除对话"))
    expect(onDismissConversation).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "删除" }))
    await waitFor(() => expect(onDismissConversation).toHaveBeenCalledWith("conversation-app-1"))
  })

  it("shows unread reminders even when notifications are muted", () => {
    const conversation = createAppConversation()
    conversation.pinned = true
    conversation.notificationMuted = true
    conversation.unreadCount = 6
    conversation.lastMentionedSeq = 2

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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    expect(screen.getByLabelText("已置顶")).toBeInTheDocument()
    expect(screen.getByLabelText("消息免打扰已开启")).toBeInTheDocument()
    expect(screen.getByLabelText("有未读消息")).toBeInTheDocument()
    expect(screen.queryByLabelText("6 条未读消息")).not.toBeInTheDocument()
    expect(screen.getByText("[有人 @ 我]")).toBeInTheDocument()
  })

  it("uses the topic source sender avatar and expires inactive topic rows", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-28T10:00:00Z"))
    const parent = createAppConversation()
    parent.id = "group-1"
    parent.name = "产品群"
    parent.type = "group"
    const topic = createTopicConversation()

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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    expect(screen.getByText("发布计划")).toBeInTheDocument()
    expect(screen.getByLabelText("Alice")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001)
    })

    expect(screen.queryByText("发布计划")).not.toBeInTheDocument()
  })

  it("shows the sender name before a group conversation message", () => {
    const conversation = createAppConversation()
    conversation.type = "group"
    conversation.name = "产品讨论组"
    conversation.lastMessageSummary = "方案已经更新"
    conversation.lastMessageSender = {
      id: "user-2",
      name: "张三",
      nickname: "小张",
      type: "user",
    }

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
          onSetConversationMuted={vi.fn()}
          onSetConversationPinned={vi.fn()}
        />
      </SidebarProvider>,
    )

    expect(screen.getByText("小张：方案已经更新")).toBeInTheDocument()
  })
})

function createAppConversation(): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-17T00:00:00Z",
    id: "conversation-app-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
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
  }
}

function createTopicConversation(): ClientConversation {
  return {
    ...createAppConversation(),
    createdAt: "2026-07-28T09:30:59Z",
    id: "topic-1",
    lastMessageAt: "2026-07-28T09:30:59Z",
    name: "发布计划",
    topic: {
      archived: false,
      parentConversationId: "group-1",
      parentConversationName: "产品群",
      parentConversationType: "group",
      participating: true,
      sourceMessageId: "message-1",
      sourceMessageSeq: 1,
      sourceSender: {
        avatar: "",
        id: "user-2",
        name: "Alice",
        type: "user",
      },
    },
    type: "topic",
  }
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
