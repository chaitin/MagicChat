import { act, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { GlobalSearchCommand } from "@/components/global-search-command"
import type {
  ClientConversation,
  ClientConversationMember,
  ClientMessageSearchResult,
  ContactApp,
  ContactGroup,
  ContactUser,
} from "@/lib/client-data-api"
import type { MessageSearchProvider } from "@/lib/client-search"
import type { DirectorySearchItem } from "@/lib/local-search"

describe("GlobalSearchCommand", () => {
  it("opens and focuses search with Ctrl+F", async () => {
    renderSearch([])

    const eventAccepted = fireEvent.keyDown(window, {
      ctrlKey: true,
      key: "f",
    })

    expect(eventAccepted).toBe(false)
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "搜索所有内容" })).toHaveFocus()
  })

  it("switches between combined, directory, conversation, and message scopes", async () => {
    const user = userEvent.setup()
    renderSearch([createConversation({ name: "产品对话" })], vi.fn(), {
      contacts: [createContact({ name: "产品联系人" })],
    })

    await openSearch(user)
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
    expect(screen.getByText("输入关键词开始搜索")).toBeInTheDocument()
    expect(screen.queryByText("未找到相关内容")).not.toBeInTheDocument()

    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "产品"
    )
    expect(
      await screen.findByRole("group", { name: "通讯录" })
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("group", { name: "会话" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "通讯录" }))
    expect(screen.getByRole("group", { name: "通讯录" })).toBeInTheDocument()
    expect(
      screen.queryByRole("group", { name: "会话" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "对话" }))
    expect(
      screen.queryByRole("group", { name: "通讯录" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "会话" })).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "聊天记录" }))
    expect(await screen.findByText("未找到相关内容")).toBeInTheDocument()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
  })

  it("searches and opens a directory item", async () => {
    const user = userEvent.setup()
    const onSelectDirectoryItem = vi.fn()
    const contact = createContact({ name: "李小明", nickname: "小明" })
    renderSearch([], vi.fn(), { contacts: [contact], onSelectDirectoryItem })

    await openSearch(user)
    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "lxm"
    )
    const result = await screen.findByRole("option", { name: /小明/ })
    expect(result).toHaveTextContent(contact.email)
    await user.click(result)

    expect(onSelectDirectoryItem).toHaveBeenCalledWith(contact)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens from the search button and preserves conversation order", async () => {
    const user = userEvent.setup()

    renderSearch([
      createConversation({
        id: "newer",
        lastMessageAt: "2026-07-14T10:00:00Z",
        name: "最近会话",
      }),
      createConversation({
        id: "older",
        lastMessageAt: "2026-07-14T09:00:00Z",
        name: "较早会话",
      }),
    ])

    await user.click(screen.getByRole("button", { name: "全局搜索" }))

    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "搜索所有内容" })).toHaveFocus()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()

    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "会话"
    )
    expect(
      await screen.findByRole("group", { name: "会话" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("最近会话")
  })

  it("shows and searches a topic with its parent conversation name", async () => {
    const user = userEvent.setup()
    renderSearch([
      createConversation({
        name: "发布计划",
        topic: {
          archived: false,
          parentConversationId: "parent-1",
          parentConversationName: "产品群",
          parentConversationType: "group",
          participating: true,
          sourceMessageId: "message-1",
          sourceMessageSeq: 1,
          sourceSender: {
            avatar: "/avatars/alice.webp",
            id: "user-2",
            name: "Alice",
            type: "user",
          },
        },
        type: "topic",
      }),
    ])

    await openSearch(user)
    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "产品群"
    )

    expect(
      await screen.findByRole("option", { name: /发布计划 - 产品群/ })
    ).toBeVisible()
  })

  it("searches conversations by pinyin and selects a result", async () => {
    const user = userEvent.setup()
    const onSelectConversation = vi.fn()
    renderSearch(
      [
        createConversation({
          id: "direct-zhang",
          members: [
            createMember({ id: "current-user", name: "当前用户" }),
            createMember({ id: "zhang", name: "张三", nickname: "小张" }),
          ],
          name: "产品搭档",
        }),
      ],
      onSelectConversation
    )

    await openSearch(user)
    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "xz"
    )

    const result = await screen.findByRole("option", { name: /产品搭档/ })
    expect(result).toHaveTextContent("匹配成员：小张")
    await user.click(result)

    expect(onSelectConversation).toHaveBeenCalledWith("direct-zhang")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("supports keyboard navigation and clears the keyword when closed", async () => {
    const user = userEvent.setup()
    const onSelectConversation = vi.fn()
    renderSearch(
      [
        createConversation({ id: "first", name: "项目一" }),
        createConversation({ id: "second", name: "项目二" }),
      ],
      onSelectConversation
    )

    await openSearch(user)
    const input = screen.getByRole("combobox", { name: "搜索所有内容" })
    await user.type(input, "项目")
    await screen.findByRole("group", { name: "会话" })
    await user.keyboard("{ArrowDown}{Enter}")

    expect(onSelectConversation).toHaveBeenCalledWith("second")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await openSearch(user)
    expect(screen.getByRole("combobox", { name: "搜索所有内容" })).toHaveValue(
      ""
    )
  })

  it("shows a global empty state", async () => {
    const user = userEvent.setup()
    renderSearch([createConversation({ name: "设计讨论" })])

    await openSearch(user)
    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "不存在"
    )

    expect(await screen.findByText("未找到相关内容")).toBeInTheDocument()
    expect(
      screen.getByText("未找到相关内容").closest("[data-slot=empty]")
    ).toBeInTheDocument()
    expect(screen.queryByRole("option")).not.toBeInTheDocument()
  })

  it("searches chat history through the API provider", async () => {
    const user = userEvent.setup()
    const onSelectMessageResult = vi.fn()
    const messageSearch = vi.fn(async () => [createMessageSearchResult()])
    renderSearch([], vi.fn(), { messageSearch, onSelectMessageResult })

    await openSearch(user)
    await user.click(screen.getByRole("tab", { name: "聊天记录" }))
    await user.type(
      screen.getByRole("combobox", { name: "搜索所有内容" }),
      "发布计划"
    )

    const result = await screen.findByRole("option", {
      name: /发布群.*张三：发布计划已确认/,
    })
    expect(messageSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: "发布计划" })
    )
    await user.click(result)

    expect(onSelectMessageResult).toHaveBeenCalledWith(
      createMessageSearchResult()
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps current results when conversation data refreshes", async () => {
    vi.useFakeTimers()
    const conversation = createConversation({ name: "产品对话" })
    const messageSearch = vi.fn(async () => [])
    const staticProps = {
      contactApps: [] as ContactApp[],
      contactGroups: [] as ContactGroup[],
      contacts: [] as ContactUser[],
      currentUserId: "current-user",
      getConversationDescription,
      messageSearch,
      onSelectConversation: vi.fn(),
      onSelectDirectoryItem: vi.fn(),
      searchDebounceMs: 500,
    }

    try {
      const view = render(
        <GlobalSearchCommand {...staticProps} conversations={[conversation]} />
      )
      fireEvent.click(screen.getByRole("button", { name: "全局搜索" }))
      fireEvent.change(screen.getByRole("combobox", { name: "搜索所有内容" }), {
        target: { value: "产品" },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(screen.getByRole("option", { name: /产品对话/ })).toBeVisible()
      expect(messageSearch).toHaveBeenCalledTimes(1)

      view.rerender(
        <GlobalSearchCommand
          {...staticProps}
          conversations={[{ ...conversation }]}
        />
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })

      expect(screen.getByRole("option", { name: /产品对话/ })).toBeVisible()
      expect(messageSearch).toHaveBeenCalledTimes(1)
      expect(screen.queryByText("正在搜索")).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
    messageSearch = vi.fn(async () => []),
    onSelectDirectoryItem = vi.fn(),
    onSelectMessageResult,
  }: {
    contactApps?: ContactApp[]
    contactGroups?: ContactGroup[]
    contacts?: ContactUser[]
    messageSearch?: MessageSearchProvider
    onSelectDirectoryItem?: (item: DirectorySearchItem) => void
    onSelectMessageResult?: (result: ClientMessageSearchResult) => void
  } = {}
) {
  return render(
    <GlobalSearchCommand
      contactApps={contactApps}
      contactGroups={contactGroups}
      contacts={contacts}
      conversations={conversations}
      currentUserId="current-user"
      getConversationDescription={getConversationDescription}
      messageSearch={messageSearch}
      onSelectDirectoryItem={onSelectDirectoryItem}
      onSelectConversation={onSelectConversation}
      onSelectMessageResult={onSelectMessageResult}
      searchDebounceMs={0}
    />
  )
}

function createMessageSearchResult(): ClientMessageSearchResult {
  return {
    conversation: {
      avatar: "",
      id: "conversation-message",
      name: "发布群",
      type: "group",
    },
    message: {
      body: { content: "发布计划已确认", type: "text" },
      clientMessageId: "",
      conversationId: "conversation-message",
      createdAt: "2026-07-29T10:00:00Z",
      id: "message-search-1",
      reactionVersion: 0,
      reactions: [],
      sender: { id: "user-1", type: "user" },
      seq: 12,
    },
    senderName: "张三",
    summary: "发布计划已确认",
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

function getConversationDescription(conversation: ClientConversation) {
  return conversation.lastMessageSummary.trim() || "暂无消息"
}

function createConversation(
  overrides: Partial<ClientConversation> = {}
): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-01T00:00:00Z",
    id: "conversation-1",
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "暂无消息",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 0,
    members: [],
    name: "普通会话",
    type: "direct",
    unreadCount: 0,
    visibility: "private",
    ...overrides,
    lastMessageSender: overrides.lastMessageSender ?? null,
  }
}

function createMember(
  overrides: Partial<ClientConversationMember> = {}
): ClientConversationMember {
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
