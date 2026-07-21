import { act, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientDataProvider } from "@/components/client-data-provider"
import { useClientData } from "@/lib/client-data-context"

describe("ClientDataProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("refreshes client data on the 15 second refresh interval", async () => {
    vi.useFakeTimers()

    let meRequestCount = 0
    let contactsRequestCount = 0
    let conversationRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (url === "/api/client/me") {
        meRequestCount += 1
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }

      if (url === "/api/client/contacts") {
        contactsRequestCount += 1
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }

      if (url === "/api/client/conversations") {
        conversationRequestCount += 1

        return Promise.resolve(
          jsonResponse(
            createConversationsResponse(
              conversationRequestCount === 1
                ? [createConversationResponse("conversation-1")]
                : [
                    createConversationResponse("conversation-1"),
                    createConversationResponse("conversation-2"),
                  ]
            )
          )
        )
      }

      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }

      return Promise.reject(new Error(`unexpected request: ${url}`))
    })

    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationCount />
        </ClientDataProvider>
      </MemoryRouter>
    )

    await act(async () => undefined)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("conversation-count")).toHaveTextContent("1")
    expect(meRequestCount).toBe(1)
    expect(contactsRequestCount).toBe(1)
    expect(conversationRequestCount).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(screen.getByTestId("conversation-count")).toHaveTextContent("2")
    expect(meRequestCount).toBe(2)
    expect(contactsRequestCount).toBe(2)
    expect(conversationRequestCount).toBe(2)
  })

  it("removes an archived topic from the conversation list immediately", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(
            createConversationsResponse([createTopicConversationResponse()])
          )
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <TopicArchiveProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("topic-count")).toHaveTextContent("1")
    act(() => screen.getByRole("button", { name: "archive topic" }).click())
    expect(screen.getByTestId("topic-count")).toHaveTextContent("0")
  })

  it("recovers exact reactions for version gaps and loaded-conversation sync", async () => {
    vi.useFakeTimers()
    let snapshotRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(
            createConversationsResponse([
              createConversationResponse("conversation-1"),
            ])
          )
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (
        url === "/api/client/conversations/conversation-1/messages?limit=20"
      ) {
        return Promise.resolve(jsonResponse(createMessagesResponse()))
      }
      if (
        url ===
        "/api/client/conversations/conversation-1/messages/reactions/query"
      ) {
        snapshotRequestCount += 1
        return Promise.resolve(
          jsonResponse(
            createReactionSnapshotsResponse(
              snapshotRequestCount === 1 ? 3 : 4,
              snapshotRequestCount === 1 ? "👍" : "🎉"
            )
          )
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ReactionSyncProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load messages" }).click()
    })
    expect(screen.getByTestId("reaction-state")).toHaveTextContent("1:none")

    await act(async () => {
      screen.getByRole("button", { name: "receive version gap" }).click()
    })
    expect(screen.getByTestId("reaction-state")).toHaveTextContent("3:👍")

    await act(async () => {
      screen.getByRole("button", { name: "sync loaded messages" }).click()
    })
    expect(screen.getByTestId("reaction-state")).toHaveTextContent("4:🎉")
    expect(snapshotRequestCount).toBe(2)
  })
})

function ConversationCount() {
  const { conversations } = useClientData()

  return <div data-testid="conversation-count">{conversations.length}</div>
}

function TopicArchiveProbe() {
  const { conversations, updateMessageTopic } = useClientData()

  return (
    <>
      <button
        aria-label="archive topic"
        onClick={() =>
          updateMessageTopic?.("parent-1", "message-1", {
            archived: true,
            conversationId: "topic-1",
          })
        }
        type="button"
      />
      <div data-testid="topic-count">{conversations.length}</div>
    </>
  )
}

function ReactionSyncProbe() {
  const {
    ensureConversationMessages,
    getConversationMessageState,
    handleIncomingMessageReactionsUpdate,
    syncLoadedConversationMessages,
  } = useClientData()
  const message = getConversationMessageState("conversation-1").messages[0]

  return (
    <>
      <button
        aria-label="load messages"
        onClick={() => ensureConversationMessages("conversation-1")}
        type="button"
      />
      <button
        aria-label="receive version gap"
        onClick={() =>
          handleIncomingMessageReactionsUpdate({
            actorReacted: true,
            actorText: "👍",
            actorUserId: "user-2",
            conversationId: "conversation-1",
            messageId: "message-1",
            reactionVersion: 3,
            reactions: [
              {
                count: 2,
                text: "👍",
                users: [
                  { id: "user-1", name: "Me" },
                  { id: "user-2", name: "Alice" },
                ],
              },
            ],
          })
        }
        type="button"
      />
      <button
        aria-label="sync loaded messages"
        onClick={syncLoadedConversationMessages}
        type="button"
      />
      <div data-testid="reaction-state">
        {message
          ? `${message.reactionVersion}:${message.reactions[0]?.text ?? "none"}`
          : "unloaded"}
      </div>
    </>
  )
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  })
}

function createCurrentUserResponse() {
  return {
    data: {
      user: {
        created_at: "2026-07-09T00:00:00Z",
        email: "me@example.com",
        id: "user-1",
        name: "Me",
      },
    },
    success: true,
  }
}

function createContactsResponse() {
  return {
    data: {
      apps: [],
      groups: [],
      users: [],
    },
    success: true,
  }
}

function createConversationsResponse(conversations: unknown[]) {
  return {
    data: {
      conversations,
    },
    success: true,
  }
}

function createProjectsResponse() {
  return {
    data: {
      next_cursor: null,
      personal_project: {
        avatar: "",
        created_at: "2026-07-09T00:00:00Z",
        current_user_role: "owner",
        description: "",
        group_count: 0,
        id: "personal-project-1",
        is_personal: true,
        member_count: 1,
        name: "个人工作区",
        owner: {
          avatar: "",
          id: "user-1",
          name: "Me",
          nickname: "",
        },
        task_counts: {
          canceled: 0,
          done: 0,
          in_progress: 0,
          todo: 0,
          total: 0,
        },
        updated_at: "2026-07-09T00:00:00Z",
      },
      projects: [],
    },
    success: true,
  }
}

function createMessagesResponse() {
  return {
    data: {
      messages: [
        {
          body: { content: "hello", type: "text" },
          client_message_id: "client-message-1",
          conversation_id: "conversation-1",
          created_at: "2026-07-21T00:00:00Z",
          id: "message-1",
          reaction_version: 1,
          reactions: [],
          sender: { id: "user-2", type: "user" },
          seq: 1,
        },
      ],
      page: {
        has_more_after: false,
        has_more_before: false,
        limit: 20,
        newest_seq: 1,
        oldest_seq: 1,
      },
    },
    success: true,
  }
}

function createReactionSnapshotsResponse(version: number, text: string) {
  return {
    data: {
      conversation_id: "conversation-1",
      snapshots: [
        {
          message_id: "message-1",
          reaction_version: version,
          reactions: [
            {
              count: 1,
              reacted_by_me: true,
              text,
              users: [{ id: "user-1", name: "Me" }],
            },
          ],
        },
      ],
    },
    success: true,
  }
}

function createConversationResponse(id: string) {
  return {
    created_at: "2026-07-09T00:00:00Z",
    id,
    name: id,
    type: "direct",
  }
}

function createTopicConversationResponse() {
  return {
    created_at: "2026-07-09T00:00:00Z",
    id: "topic-1",
    name: "Topic",
    type: "topic",
    topic: {
      archived: false,
      parent_conversation_id: "parent-1",
      parent_conversation_name: "Parent",
      parent_conversation_type: "group",
      participating: true,
      source_message_id: "message-1",
      source_message_seq: 1,
      source_sender: {
        avatar: "/avatars/alice.webp",
        id: "user-1",
        name: "Alice",
        type: "user",
      },
    },
  }
}
