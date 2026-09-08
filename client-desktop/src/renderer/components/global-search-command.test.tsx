import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { GlobalSearchCommand } from "@/components/global-search-command"
import { getConversationDefaultDescription } from "@/lib/conversation-search-description"
import type {
  ClientConversation,
  ClientConversationMember,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import type { DirectorySearchItem } from "@/lib/local-search"
import type { MessageSearchProvider } from "@/lib/client-search"

describe("GlobalSearchCommand", () => {
  afterEach(() => {
    delete (window as { desktop?: unknown }).desktop
  })

  it("从完整搜索入口使用键盘打开搜索并选择会话", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderSearch([createConversation({ name: "设计讨论" })], onSelect, { expanded: true })
    expect(screen.getByText("搜索消息、联系人、会话")).toBeInTheDocument()
    screen.getByRole("button", { name: "全局搜索" }).focus()
    await user.keyboard("{Enter}")
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "设计")
    await user.click(screen.getByRole("option", { name: /设计讨论/ }))
    expect(onSelect).toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("订阅全局搜索事件并打开搜索框", async () => {
    const listeners: Array<() => void> = []
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        shortcuts: {
          subscribeSearchOpen: (listener: () => void) => {
            listeners.push(listener)
            return () => {
              const index = listeners.indexOf(listener)
              if (index >= 0) listeners.splice(index, 1)
            }
          },
        },
      },
    })
    renderSearch([])
    expect(listeners).toHaveLength(1)

    act(() => listeners[0]())
    expect(await screen.findByRole("combobox", { name: "搜索所有内容" })).toBeInTheDocument()
  })

  it("switches between combined, directory, and conversation scopes", async () => {
    const user = userEvent.setup()
    renderSearch([createConversation({ name: "产品对话" })], vi.fn(), {
      contacts: [createContact({ name: "产品联系人" })],
    })

    await openSearch(user)
    expect(screen.getByText("输入关键词开始搜索")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "聊天记录" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "文档" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "任务" })).toBeInTheDocument()

    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "产品")
    expect(screen.getByText("产品联系人")).toBeInTheDocument()
    expect(screen.getByText("产品对话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "通讯录" }))
    expect(screen.getByText("产品联系人")).toBeInTheDocument()
    expect(screen.queryByText("产品对话")).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "对话" }))
    expect(screen.queryByText("产品联系人")).not.toBeInTheDocument()
    expect(screen.getByText("产品对话")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "聊天记录" }))
    expect(screen.getByText("正在搜索")).toBeInTheDocument()
  })

  it("shows directory avatars and opens a pinyin-matched contact", async () => {
    const user = userEvent.setup()
    const onSelectDirectoryItem = vi.fn()
    const contact = createContact({
      avatar: "/avatars/ming.webp",
      name: "李小明",
      nickname: "小明",
    })
    renderSearch([], vi.fn(), { contacts: [contact], onSelectDirectoryItem })

    await openSearch(user)
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "lxm")
    const option = screen.getByRole("option", { name: /小明/ })
    expect(screen.getByLabelText("小明")).toBeInTheDocument()
    expect(option).toHaveTextContent(contact.email)
    await user.click(option)

    expect(onSelectDirectoryItem).toHaveBeenCalledWith(contact)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("describes matched conversation fields", async () => {
    const user = userEvent.setup()
    renderSearch([
      createConversation({
        id: "direct-zhang",
        members: [
          createMember({ id: "current-user", name: "当前用户" }),
          createMember({ email: "zhang@example.com", id: "zhang", name: "张三", nickname: "小张" }),
        ],
        name: "产品搭档",
      }),
    ])

    await openSearch(user)
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "zhang@example")

    expect(screen.getByRole("option", { name: /产品搭档/ })).toHaveTextContent(
      "匹配邮箱：小张 · zhang@example.com",
    )
  })

  it("supports looping keyboard navigation and exposes the active descendant", async () => {
    const user = userEvent.setup()
    const onSelectConversation = vi.fn()
    renderSearch(
      [
        createConversation({ id: "first", name: "项目一" }),
        createConversation({ id: "second", name: "项目二" }),
      ],
      onSelectConversation,
    )

    await openSearch(user)
    const input = screen.getByRole("combobox", { name: "搜索所有内容" })
    await user.type(input, "项目")
    expect(input).toHaveAttribute("aria-activedescendant", "global-search-option-0")

    await user.keyboard("{ArrowUp}")
    expect(input).toHaveAttribute("aria-activedescendant", "global-search-option-1")
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(onSelectConversation).toHaveBeenCalledWith("second")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await openSearch(user)
    expect(screen.getByRole("combobox", { name: "搜索所有内容" })).toHaveValue("")
  })

  it("debounces message search and supports host shortcut plus keyboard selection", async () => {
    const listeners: Array<() => void> = []
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        shortcuts: {
          subscribeSearchOpen: (listener: () => void) => {
            listeners.push(listener)
            return () => {
              const index = listeners.indexOf(listener)
              if (index >= 0) listeners.splice(index, 1)
            }
          },
        },
      },
    })
    const user = userEvent.setup()
    const result = createMessageSearchResult()
    const messageSearch = vi.fn().mockResolvedValue([result])
    const onSelectMessageResult = vi.fn()
    renderSearch([], vi.fn(), {
      messageSearch,
      onSelectMessageResult,
      searchDebounceMs: 0,
    })

    act(() => listeners[0]())
    const input = screen.getByRole("combobox", { name: "搜索所有内容" })
    expect(input).toHaveFocus()
    await user.click(screen.getByRole("tab", { name: "聊天记录" }))
    await user.type(input, "计划")
    expect(await screen.findByRole("option", { name: /项目群/ })).toHaveTextContent(
      "Alice：发布计划",
    )
    expect(messageSearch).toHaveBeenCalledWith(expect.objectContaining({ keyword: "计划" }))
    await user.keyboard("{Enter}")
    expect(onSelectMessageResult).toHaveBeenCalledWith(result)
  })

  it("不再响应硬编码的 Ctrl/Cmd+F，仅通过宿主订阅打开搜索", async () => {
    const user = userEvent.setup()
    renderSearch([])

    await user.keyboard("{Control>}f{/Control}")
    expect(screen.queryByRole("combobox", { name: "搜索所有内容" })).not.toBeInTheDocument()

    await user.keyboard("{Meta>}f{/Meta}")
    expect(screen.queryByRole("combobox", { name: "搜索所有内容" })).not.toBeInTheDocument()
  })

  it("无消息会话的默认描述显示暂无消息文案", () => {
    const t = (key: string) => (key === "search.noMessages" ? "暂无消息" : key)
    expect(
      getConversationDefaultDescription(createConversation({ lastMessageSummary: "" }), t),
    ).toBe("暂无消息")
    expect(
      getConversationDefaultDescription(
        createConversation({ lastMessageSummary: "最近一条消息" }),
        t,
      ),
    ).toBe("最近一条消息")
  })
})

async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "全局搜索" }))
}

function renderSearch(
  conversations: ClientConversation[],
  onSelectConversation = vi.fn(),
  {
    contactApps = [],
    contactGroups = [],
    contacts = [],
    messageSearch,
    onSelectDirectoryItem = vi.fn(),
    onSelectMessageResult,
    searchDebounceMs,
    expanded,
  }: {
    contactApps?: ContactApp[]
    contactGroups?: ContactGroup[]
    contacts?: ContactUser[]
    messageSearch?: MessageSearchProvider
    onSelectDirectoryItem?: (item: DirectorySearchItem) => void
    onSelectMessageResult?: (result: ClientMessageSearchResult) => void
    searchDebounceMs?: number
    expanded?: boolean
  } = {},
) {
  return render(
    <GlobalSearchCommand
      contactApps={contactApps}
      contactGroups={contactGroups}
      contacts={contacts}
      conversations={conversations}
      currentUserId="current-user"
      getConversationDescription={(conversation) => conversation.lastMessageSummary}
      messageSearch={messageSearch}
      onSelectDirectoryItem={onSelectDirectoryItem}
      onSelectMessageResult={onSelectMessageResult}
      onSelectConversation={onSelectConversation}
      searchDebounceMs={searchDebounceMs}
      expanded={expanded}
    />,
  )
}

function createMessageSearchResult(): ClientMessageSearchResult {
  return {
    conversation: { avatar: "", id: "conversation-1", name: "项目群", type: "group" },
    message: {
      body: { content: "发布计划", type: "text" },
      clientMessageId: "client-message-9",
      conversationId: "conversation-1",
      createdAt: "2026-07-31T00:00:00Z",
      id: "message-9",
      reactionVersion: 0,
      reactions: [],
      sender: { id: "user-2", type: "user" },
      seq: 9,
    },
    senderName: "Alice",
    summary: "发布计划",
  }
}

function createContact(overrides: Partial<ContactUser> = {}): ContactUser {
  return {
    avatar: "",
    email: "contact@example.com",
    id: "contact-1",
    lastOnlineAt: null,
    name: "联系人",
    nickname: "",
    online: true,
    phone: "",
    type: "user",
    ...overrides,
  }
}

function createConversation(overrides: Partial<ClientConversation> = {}): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-01T00:00:00Z",
    id: "conversation-1",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "暂无消息",
    lastReadSeq: 0,
    memberCount: 0,
    members: [],
    name: "普通会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
  }
}

function createMember(overrides: Partial<ClientConversationMember> = {}): ClientConversationMember {
  return {
    avatar: "",
    email: "member@example.com",
    id: "member-1",
    name: "成员",
    nickname: "",
    phone: "",
    role: "member",
    type: "user",
    ...overrides,
  }
}
