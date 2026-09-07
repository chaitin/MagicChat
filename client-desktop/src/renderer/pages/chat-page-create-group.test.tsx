import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ChatPage } from "@/pages/chat-page"
import { ClientDataRequestError } from "@/lib/client-data-api"
import type {
  ClientConversation,
  ClientMessage,
  ClientTopicSourceMessage,
  ClientUser,
} from "@/lib/client-data-api"
import { ClientDataContext, type ClientDataContextValue } from "@/lib/client-data-context"
import { createConversationMessageState } from "@/lib/client-data-state"
import { readLastConversationId, writeLastConversationId } from "@/lib/last-conversation"
import { RealtimeContext } from "@/lib/realtime-context"

const mocks = vi.hoisted(() => ({
  createConversationTopic: vi.fn(),
  getConversationTopic: vi.fn(),
  listConversationMessageReactionSnapshots: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock("@/lib/client-data-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client-data-api")>()
  return {
    ...actual,
    createConversationTopic: mocks.createConversationTopic,
    getConversationTopic: mocks.getConversationTopic,
    listConversationMessageReactionSnapshots: mocks.listConversationMessageReactionSnapshots,
  }
})

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }))

describe("ChatPage create group dialog", () => {
  it("creates groups with and without selected apps", async () => {
    for (const appIds of [[], ["app-1"]]) {
      const user = userEvent.setup()
      const createGroupConversation = vi.fn().mockResolvedValue(createGroupConversationResponse())
      const view = renderChatPage({ createGroupConversation })

      await openCreateGroupDialog(user)
      expect(screen.getByLabelText("群聊名称")).toHaveValue("新建群聊")

      if (appIds.length > 0) {
        await user.click(screen.getByRole("tab", { name: "应用" }))
        await user.click(screen.getByRole("checkbox", { name: "茉莉" }))
      }

      await user.click(screen.getByRole("button", { name: "创建" }))
      expect(createGroupConversation).toHaveBeenCalledWith("新建群聊", [], appIds)

      view.unmount()
    }
  })
})

describe("ChatPage create topic confirmation", () => {
  it("creates the topic only after confirmation", async () => {
    const user = userEvent.setup()
    const conversation = createConversation("conversation-1", "产品群")
    const sourceMessage = createSourceMessage(conversation.id)
    mocks.createConversationTopic.mockReset()
    mocks.createConversationTopic.mockImplementation(() => new Promise(() => undefined))
    renderChatPage(
      {
        ...createConversationOverrides([conversation]),
        getConversationMessageState: vi.fn(() => ({
          error: null,
          focus: null,
          historyTarget: null,
          latestKnownSeq: sourceMessage.seq,
          loaded: true,
          loading: false,
          loadingAfter: false,
          loadingBefore: false,
          messages: [sourceMessage],
          page: null,
          pendingLatestMessageCount: 0,
          sending: false,
          viewMode: "latest" as const,
        })),
        updateMessageTopic: vi.fn(),
      },
      `/chat/${conversation.id}`,
    )

    const sourceBody = await screen.findByText("讨论发布计划")
    const actionTrigger = sourceBody.closest("[data-message-action-trigger]")
    expect(actionTrigger).not.toBeNull()
    fireEvent.contextMenu(actionTrigger!)
    await user.click(await screen.findByRole("menuitem", { name: "创建话题" }))

    expect(mocks.createConversationTopic).not.toHaveBeenCalled()
    expect(
      screen.getByText("将以这条消息作为起点创建一个独立话题，方便围绕它继续讨论。"),
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "确认创建" }))

    await waitFor(() =>
      expect(mocks.createConversationTopic).toHaveBeenCalledWith(conversation.id, sourceMessage.id),
    )
  })
})

describe("ChatPage app direct access", () => {
  it("renders retained app history as read-only after access is revoked", async () => {
    const conversation: ClientConversation = {
      ...createConversation("conversation-app-1", "受限应用"),
      canSend: false,
      type: "app",
    }
    const sourceMessage = createSourceMessage(conversation.id)
    renderChatPage(
      {
        ...createConversationOverrides([conversation]),
        getConversationMessageState: vi.fn(() => ({
          error: null,
          focus: null,
          historyTarget: null,
          latestKnownSeq: sourceMessage.seq,
          loaded: true,
          loading: false,
          loadingAfter: false,
          loadingBefore: false,
          messages: [sourceMessage],
          page: null,
          pendingLatestMessageCount: 0,
          sending: false,
          viewMode: "latest" as const,
        })),
      },
      `/chat/${conversation.id}`,
    )

    expect(await screen.findByText("你当前无权直接使用此应用")).toBeVisible()
    expect(screen.queryByTestId("conversation-panel-composer")).not.toBeInTheDocument()
  })
})

describe("ChatPage topic source parity", () => {
  it("uses the directory profile for source senders on the full topic page", async () => {
    const parentConversation = createConversation("conversation-parent", "产品群")
    const topicConversation = createTopicConversation(parentConversation.id)
    const sourceMessage = {
      ...createTopicSourceMessage(),
      sender: {
        avatar: "",
        id: "user-2",
        name: "过期名称",
        type: "user" as const,
      },
    }
    mocks.getConversationTopic.mockReset()
    mocks.getConversationTopic.mockResolvedValue({
      canArchive: false,
      canParticipate: false,
      conversation: topicConversation,
      parentConversation: {
        id: parentConversation.id,
        name: parentConversation.name,
        type: "group",
      },
      sourceMessage,
    })
    mocks.listConversationMessageReactionSnapshots.mockReset()
    mocks.listConversationMessageReactionSnapshots.mockResolvedValue([])

    renderChatPage(
      {
        ...createConversationOverrides([parentConversation, topicConversation]),
        usersById: {
          "user-2": {
            avatar: "/avatars/member.webp",
            email: "member@example.test",
            id: "user-2",
            lastOnlineAt: null,
            name: "群成员姓名",
            nickname: "群成员昵称",
            online: false,
            phone: "",
            type: "user",
          },
        },
      },
      `/chat/${topicConversation.id}`,
    )

    expect(await screen.findByText("群成员昵称")).toBeVisible()
  })

  it("wires reactions, forwarding, and multi-select on the full topic page", async () => {
    const parentConversation = createConversation("conversation-parent", "产品群")
    const topicConversation = createTopicConversation(parentConversation.id)
    const sourceMessage = createTopicSourceMessage()
    mocks.getConversationTopic.mockReset()
    mocks.getConversationTopic.mockResolvedValue({
      canArchive: false,
      canParticipate: false,
      conversation: topicConversation,
      parentConversation: {
        id: parentConversation.id,
        name: parentConversation.name,
        type: "group",
      },
      sourceMessage,
    })
    mocks.listConversationMessageReactionSnapshots.mockReset()
    mocks.listConversationMessageReactionSnapshots.mockResolvedValue([
      {
        conversationId: parentConversation.id,
        messageId: sourceMessage.id,
        reactionVersion: 2,
        reactions: [
          {
            count: 1,
            reactedByMe: false,
            text: "👍",
            users: [{ id: "user-2", name: "Bob" }],
          },
        ],
      },
    ])

    renderChatPage(
      {
        ...createConversationOverrides([parentConversation, topicConversation]),
        getConversationMessageState: vi.fn(() => ({
          error: null,
          focus: null,
          historyTarget: null,
          latestKnownSeq: 0,
          loaded: true,
          loading: false,
          loadingAfter: false,
          loadingBefore: false,
          messages: [],
          page: null,
          pendingLatestMessageCount: 0,
          sending: false,
          viewMode: "latest" as const,
        })),
      },
      `/chat/${topicConversation.id}`,
    )

    expect(await screen.findByRole("button", { name: "添加表情 👍" })).toBeVisible()
    fireEvent.contextMenu(screen.getByTestId("topic-source-message-bubble"))
    expect(screen.getByRole("menuitem", { name: "转发" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "多选" })).toBeVisible()
    expect(mocks.listConversationMessageReactionSnapshots).toHaveBeenCalledWith(
      parentConversation.id,
      [sourceMessage.id],
    )
  })
})

describe("ChatPage global search navigation", () => {
  it("从当前聊天页打开新朋友对话框并刷新申请状态", async () => {
    const user = userEvent.setup()
    const refreshFriendData = vi.fn().mockResolvedValue(undefined)
    renderChatPage({
      acceptFriendRequest: vi.fn().mockResolvedValue(undefined),
      cancelFriendRequest: vi.fn().mockResolvedValue(undefined),
      createFriendRequest: vi.fn().mockResolvedValue(undefined),
      ensureUsers: vi.fn().mockResolvedValue(undefined),
      refreshFriendData,
      rejectFriendRequest: vi.fn().mockResolvedValue(undefined),
    })

    await user.click(screen.getByRole("button", { name: "新建 Agent" }))
    await user.click(await screen.findByRole("menuitem", { name: "添加好友" }))

    expect(await screen.findByRole("dialog", { name: "新朋友" })).toBeVisible()
    await waitFor(() => expect(refreshFriendData).toHaveBeenCalledWith({ includeContacts: false }))
  })

  it("保留好友授权失败的服务端文案并允许重新打开私信", async () => {
    const user = userEvent.setup()
    mocks.toastError.mockReset()
    const existingConversation = createConversation("conversation-1", "产品群")
    const error = new ClientDataRequestError("仅支持向好友发送私信", {
      code: "direct_friendship_required",
      status: 403,
    })
    const openDirectConversation = vi.fn().mockRejectedValue(error)
    renderChatPage(
      {
        ...createConversationOverrides([existingConversation]),
        openDirectConversation,
      },
      `/chat/${existingConversation.id}`,
    )

    await user.click(screen.getByRole("button", { name: "全局搜索" }))
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "Bob")
    const bobOption = await screen.findByRole("option", { name: /Bob/ })
    await user.click(bobOption)

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(error.message))
    expect(screen.getByTestId("chat-location")).toHaveTextContent(
      `/chat/${existingConversation.id}`,
    )

    await user.click(screen.getByRole("button", { name: "全局搜索" }))
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "Bob")
    await user.click(await screen.findByRole("option", { name: /Bob/ }))
    await waitFor(() => expect(openDirectConversation).toHaveBeenCalledTimes(2))
  })

  it("does not let a pending directory result override a later conversation selection", async () => {
    const user = userEvent.setup()
    const existingConversation = createConversation("conversation-1", "产品群")
    const openedConversation = createConversation("conversation-2", "Bob")
    const pendingOpen = createDeferred<ClientConversation>()
    const openDirectConversation = vi.fn(() => pendingOpen.promise)
    renderChatPage(
      {
        ...createConversationOverrides([existingConversation]),
        openDirectConversation,
      },
      `/chat/${existingConversation.id}`,
    )

    await user.click(screen.getByRole("button", { name: "全局搜索" }))
    await user.type(screen.getByRole("combobox", { name: "搜索所有内容" }), "Bob")
    await user.click(screen.getByRole("option", { name: /Bob/ }))
    expect(openDirectConversation).toHaveBeenCalledWith("user-2")

    await user.click(screen.getByRole("option", { name: /产品群/ }))
    expect(screen.getByTestId("chat-location")).toHaveTextContent("/chat/conversation-1")

    await act(async () => {
      pendingOpen.resolve(openedConversation)
    })
    expect(screen.getByTestId("chat-location")).toHaveTextContent("/chat/conversation-1")
  })
})

describe("ChatPage last conversation", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("records the active conversation for the current user", async () => {
    const conversation = createConversation("conversation-1", "产品群")
    renderChatPage(createConversationOverrides([conversation]), "/chat/conversation-1")

    await waitFor(() => expect(readLastConversationId("user-1")).toBe("conversation-1"))
  })

  it("restores the last valid conversation when entering /chat", async () => {
    const conversation = createConversation("conversation-1", "产品群")
    const overrides = createConversationOverrides([conversation])
    writeLastConversationId("user-1", conversation.id)

    renderChatPage(overrides)

    await waitFor(() =>
      expect(screen.getByTestId("chat-location")).toHaveTextContent("/chat/conversation-1"),
    )
    expect(overrides.ensureConversationMessages).toHaveBeenCalledWith("conversation-1")
  })

  it("reloads messages when the active conversation state disappears", async () => {
    const user = userEvent.setup()
    const conversation = createConversation("conversation-1", "产品群")
    const message = createSourceMessage(conversation.id)
    const ensureConversationMessages = vi.fn()

    function MessageStateHarness() {
      const [messageState, setMessageState] = useState({
        ...createConversationMessageState(),
        loaded: true,
        messages: [message],
      })
      return (
        <ClientDataContext.Provider
          value={createClientDataValue({
            ...createConversationOverrides([conversation]),
            ensureConversationMessages,
            getConversationMessageState: () => messageState,
          })}
        >
          <button onClick={() => setMessageState(createConversationMessageState())} type="button">
            clear message state
          </button>
          <ChatPage />
        </ClientDataContext.Provider>
      )
    }

    render(
      <MemoryRouter initialEntries={[`/chat/${conversation.id}`]}>
        <RealtimeContext.Provider
          value={{
            ready: true,
            sendRealtimeRequest: vi.fn(),
            status: "connected",
            subscribeRealtimeEvent: vi.fn(() => vi.fn()),
          }}
        >
          <Routes>
            <Route path="/chat/:conversationId?" element={<MessageStateHarness />} />
          </Routes>
        </RealtimeContext.Provider>
      </MemoryRouter>,
    )

    expect(await screen.findByText("讨论发布计划")).toBeVisible()
    expect(ensureConversationMessages).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "clear message state" }))

    await waitFor(() => expect(ensureConversationMessages).toHaveBeenCalledWith(conversation.id))
  })

  it("clears a stored conversation that is no longer available", async () => {
    writeLastConversationId("user-1", "missing-conversation")

    renderChatPage()

    await waitFor(() => expect(readLastConversationId("user-1")).toBe(""))
    expect(screen.getByTestId("chat-location")).toHaveTextContent("/chat")
  })

  it("keeps an explicit conversation route and records it as the latest", async () => {
    const previousConversation = createConversation("conversation-1", "之前的群聊")
    const explicitConversation = createConversation("conversation-2", "显式打开的群聊")
    writeLastConversationId("user-1", previousConversation.id)

    renderChatPage(
      createConversationOverrides([previousConversation, explicitConversation]),
      "/chat/conversation-2",
    )

    expect(screen.getByTestId("chat-location")).toHaveTextContent("/chat/conversation-2")
    await waitFor(() => expect(readLastConversationId("user-1")).toBe("conversation-2"))
  })
})

async function openCreateGroupDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "新建 Agent" }))
  await user.click(screen.getByRole("menuitem", { name: "发起群聊" }))
}

function renderChatPage(overrides: Partial<ClientDataContextValue> = {}, initialEntry = "/chat") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RealtimeContext.Provider
        value={{
          ready: true,
          sendRealtimeRequest: vi.fn(),
          status: "connected",
          subscribeRealtimeEvent: vi.fn(() => vi.fn()),
        }}
      >
        <ClientDataContext.Provider value={createClientDataValue(overrides)}>
          <Routes>
            <Route
              path="/chat/:conversationId?"
              element={
                <>
                  <ChatPage />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </ClientDataContext.Provider>
      </RealtimeContext.Provider>
    </MemoryRouter>,
  )
}

function LocationProbe() {
  return <output data-testid="chat-location">{useLocation().pathname}</output>
}

function createConversationOverrides(
  conversations: ClientConversation[],
): Partial<ClientDataContextValue> {
  return {
    conversations,
    ensureConversationMessages: vi.fn(),
    compactConversationMessages: vi.fn(),
    registerConversationMessageView: vi.fn(() => vi.fn()),
    getConversation: vi.fn(
      (conversationId: string) =>
        conversations.find((conversation) => conversation.id === conversationId) ?? null,
    ),
  }
}

function createClientDataValue(overrides: Partial<ClientDataContextValue>): ClientDataContextValue {
  const me: ClientUser = {
    avatar: "",
    createdAt: "2026-07-10T00:00:00Z",
    email: "alice@example.com",
    id: "user-1",
    lastOnlineAt: null,
    name: "Alice",
    nickname: "",
    phone: "",
    status: "active",
  }

  return {
    clearMessageScope: vi.fn(),
    contactApps: [
      {
        avatar: "/assets/apps/assistant.webp",
        creatorUserId: null,
        description: "AI 助手",
        id: "app-1",
        name: "茉莉",
        online: true,
        type: "app",
      },
    ],
    contactGroups: [],
    contacts: [
      {
        avatar: "",
        email: "bob@example.com",
        id: "user-2",
        lastOnlineAt: null,
        name: "Bob",
        nickname: "",
        online: false,
        phone: "",
        type: "user",
      },
    ],
    contactsError: null,
    contactsLoading: false,
    contactsRefreshing: false,
    conversations: [],
    me,
    meError: null,
    meLoading: false,
    meRefreshing: false,
    personalProject: createPersonalProject(me),
    projects: [],
    projectsError: null,
    projectsLoading: false,
    projectsLoadingMore: false,
    projectsNextCursor: null,
    projectsRefreshing: false,
    addGroupConversationMembers: vi.fn(),
    createGroupConversation: vi.fn(),
    createProject: vi.fn(),
    dissolveGroupConversation: vi.fn(),
    dismissConversation: vi.fn(),
    ensureConversationMessages: vi.fn(),
    getConversation: vi.fn(() => null),
    getConversationMessageState: vi.fn(),
    handleIncomingConversationMessage: vi.fn(),
    handleIncomingConversationMessageUpdate: vi.fn(),
    handleIncomingMessageReactionsUpdate: vi.fn(),
    joinGroupConversation: vi.fn(),
    leaveGroupConversation: vi.fn(),
    loadBeforeConversationMessages: vi.fn(),
    loadAfterConversationMessages: vi.fn(),
    consumeConversationMessageFocus: vi.fn(),
    focusConversationMessage: vi.fn(),
    replaceWithLatestMessages: vi.fn(),
    loadMoreProjects: vi.fn(),
    markConversationRead: vi.fn(),
    setConversationMuted: vi.fn(),
    setConversationPinned: vi.fn(),
    mergeIncomingConversationMessage: vi.fn(),
    openAppConversation: vi.fn(),
    openDirectConversation: vi.fn(),
    restoreConversation: vi.fn(),
    refreshContacts: vi.fn(),
    refreshConversations: vi.fn(),
    refreshFriendData: vi.fn(),
    refreshMe: vi.fn(),
    refreshProjects: vi.fn(),
    removeConversation: vi.fn(),
    removeGroupConversationMember: vi.fn(),
    revokeConversationMessage: vi.fn(),
    setMessageReaction: vi.fn(),
    sendConversationFile: vi.fn(),
    sendConversationImage: vi.fn(),
    sendConversationVoice: vi.fn(),
    sendConversationLink: vi.fn(),
    sendConversationMarkdown: vi.fn(),
    sendConversationCard: vi.fn(),
    sendConversationText: vi.fn(),
    setGroupConversationPrivate: vi.fn(),
    setGroupConversationPublic: vi.fn(),
    syncLoadedConversationMessages: vi.fn(),
    updateConversationLastMentionedSeq: vi.fn(),
    updateConversationLastChoiceSeq: vi.fn(),
    updateConversationLastMessage: vi.fn(),
    updateConversationPinned: vi.fn(),
    updateConversationMuted: vi.fn(),
    updateGroupConversationAvatar: vi.fn(),
    updateGroupConversationAnnouncement: vi.fn(),
    updateGroupConversationName: vi.fn(),
    ...overrides,
  }
}

function createPersonalProject(me: ClientUser) {
  return {
    avatar: "",
    createdAt: "2026-07-10T00:00:00Z",
    currentUserRole: "owner" as const,
    description: "",
    groupCount: 0,
    id: "personal-project-1",
    isPersonal: true,
    memberCount: 1,
    name: "个人工作区",
    owner: {
      avatar: me.avatar,
      id: me.id,
      name: me.name,
      nickname: me.nickname,
    },
    taskCounts: {
      canceled: 0,
      done: 0,
      inProgress: 0,
      todo: 0,
      total: 0,
    },
    updatedAt: "2026-07-10T00:00:00Z",
  }
}

function createGroupConversationResponse(): ClientConversation {
  return createConversation("conversation-group-1", "新建群聊")
}

function createConversation(id: string, name: string): ClientConversation {
  return {
    avatar: "",
    createdAt: "2026-07-10T00:00:00Z",
    id,
    lastMessageAt: null,
    lastMessageId: null,
    lastMessageSeq: 0,
    lastMessageSummary: "",
    lastChoiceSeq: 0,
    lastMentionedSeq: 0,
    lastReadSeq: 0,
    memberCount: 1,
    members: [],
    name,
    type: "group",
    unreadCount: 0,
    visibility: "private",
  }
}

function createTopicConversation(parentConversationId: string): ClientConversation {
  return {
    ...createConversation("topic-1", "发布计划"),
    topic: {
      archived: false,
      parentConversationId,
      parentConversationName: "产品群",
      parentConversationType: "group",
      participating: true,
      sourceMessageId: "source-message-1",
      sourceMessageSeq: 8,
      sourceSender: {
        avatar: "",
        id: "user-2",
        name: "Bob",
        type: "user",
      },
    },
    type: "topic",
  }
}

function createTopicSourceMessage(): ClientTopicSourceMessage {
  return {
    body: { content: "完整来源消息", type: "text" },
    createdAt: "2026-07-20T04:00:00Z",
    id: "source-message-1",
    revokedAt: null,
    sender: {
      avatar: "",
      id: "user-2",
      name: "Bob",
      type: "user",
    },
    seq: 8,
    summary: "完整来源消息",
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function createSourceMessage(conversationId: string): ClientMessage {
  return {
    body: { content: "讨论发布计划", type: "text" },
    clientMessageId: "client-message-1",
    conversationId,
    createdAt: "2026-07-20T10:00:00Z",
    id: "message-1",
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-1", type: "user" },
    seq: 1,
  }
}
