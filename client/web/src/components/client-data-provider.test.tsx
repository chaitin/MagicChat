import * as React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientDataProvider } from "@/components/client-data-provider"
import { useClientData } from "@/lib/client-data-context"

describe("ClientDataProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("preloads at most 30 conversations with five workers before becoming ready", async () => {
    vi.useFakeTimers()
    const conversations = Array.from({ length: 31 }, (_, index) => ({
      ...createConversationResponse(`conversation-${index + 1}`),
      created_at: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    }))
    const pending = new Map<string, (response: Response) => void>()
    let activeRequests = 0
    let maximumActiveRequests = 0
    const requestedIds: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts")
        return Promise.resolve(jsonResponse(createContactsResponse()))
      if (url === "/api/client/conversations")
        return Promise.resolve(
          jsonResponse(createConversationsResponse(conversations))
        )
      if (url === "/api/client/projects?limit=100")
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      const match = url.match(
        /^\/api\/client\/conversations\/(.+)\/messages\?limit=20$/
      )
      if (match) {
        const id = match[1]
        requestedIds.push(id)
        if (id === "conversation-3")
          return Promise.reject(new Error("failed preload"))
        activeRequests += 1
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests)
        return new Promise<Response>((resolve) => {
          pending.set(id, (response) => {
            activeRequests -= 1
            resolve(response)
          })
        })
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ClientDataProvider>
          <BootstrapPreloadProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => undefined)
    expect(screen.queryByTestId("preloaded-count")).not.toBeInTheDocument()
    expect(pending.size).toBe(5)

    while (requestedIds.length < 30) {
      const [id, resolve] = pending.entries().next().value as [
        string,
        (response: Response) => void,
      ]
      pending.delete(id)
      await act(async () => {
        resolve(jsonResponse(createMessagesResponseFor(id)))
      })
    }
    for (const [id, resolve] of [...pending]) {
      pending.delete(id)
      await act(async () =>
        resolve(jsonResponse(createMessagesResponseFor(id)))
      )
    }
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(maximumActiveRequests).toBe(5)
    expect(requestedIds).toHaveLength(30)
    expect(requestedIds).not.toContain("conversation-1")
    expect(screen.getByTestId("preloaded-count")).toHaveTextContent("29")
    expect(screen.getByTestId("failed-loaded")).toHaveTextContent("false")
    expect(screen.getByTestId("latest-message")).toHaveTextContent(
      "message-conversation-31"
    )
  })

  it("refreshes workspace data including the directory", async () => {
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
      <MemoryRouter initialEntries={["/chat"]}>
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

  it("exposes restore refresh and restores a cached conversation omitted by the limited snapshot", async () => {
    vi.useFakeTimers()
    let conversationRequests = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "/api/client/me")
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        if (url === "/api/client/contacts")
          return Promise.resolve(jsonResponse(createContactsResponse()))
        if (url === "/api/client/projects?limit=100")
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        if (url === "/api/client/conversations") {
          conversationRequests += 1
          return Promise.resolve(
            jsonResponse(
              createConversationsResponse(
                conversationRequests === 1
                  ? [createConversationResponse("old-conversation")]
                  : []
              )
            )
          )
        }
        if (url.includes("/messages?limit=20")) {
          return Promise.resolve(
            jsonResponse(createMessagesResponseFor("old-conversation"))
          )
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      })
    )

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ClientDataProvider>
          <RestoreProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(screen.getByTestId("restore-action-type")).toHaveTextContent(
      "function"
    )
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent(
      "old-conversation"
    )
    fireEvent.click(screen.getByText("remove cached"))
    expect(screen.getByTestId("conversation-ids")).toBeEmptyDOMElement()
    await act(async () => fireEvent.click(screen.getByText("remote restored")))
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent(
      "old-conversation"
    )
  })

  it("loads friend requests with a friends-only directory", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(
          jsonResponse({
            data: {
              apps: [],
              directory_mode: "friends",
              groups: [],
              user_ids: ["user-2"],
            },
            success: true,
          })
        )
      }
      if (url === "/api/client/friend-requests?direction=incoming") {
        return Promise.resolve(
          jsonResponse({
            data: {
              requests: [
                createFriendRequestResponse("request-1", "user-2", "user-1"),
              ],
            },
            success: true,
          })
        )
      }
      if (url === "/api/client/friend-requests?direction=outgoing") {
        return Promise.resolve(
          jsonResponse({ data: { requests: [] }, success: true })
        )
      }
      if (url === "/api/client/users/resolve") {
        const body = JSON.parse(String(init?.body)) as { user_ids: string[] }
        return Promise.resolve(
          jsonResponse({
            data: {
              users: body.user_ids.map((id) => ({
                avatar: "",
                email: `${id}@example.com`,
                id,
                name: "Bob",
                nickname: "",
                online: false,
                phone: "",
                type: "user",
                updated_at: "2026-08-11T00:00:00Z",
              })),
            },
            success: true,
          })
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/contacts"]}>
        <ClientDataProvider>
          <FriendDirectoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("directory-mode")).toHaveTextContent("friends")
    expect(screen.getByTestId("incoming-count")).toHaveTextContent("1")
    expect(screen.getByTestId("friend-name")).toHaveTextContent("Bob")
  })

  it("does not expose pending request users as contacts", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(
          jsonResponse({
            data: {
              apps: [],
              directory_mode: "friends",
              groups: [],
              user_ids: [],
            },
            success: true,
          })
        )
      }
      if (url === "/api/client/friend-requests?direction=incoming") {
        return Promise.resolve(
          jsonResponse({
            data: {
              requests: [
                createFriendRequestResponse("request-1", "user-2", "user-1"),
              ],
            },
            success: true,
          })
        )
      }
      if (url === "/api/client/friend-requests?direction=outgoing") {
        return Promise.resolve(
          jsonResponse({ data: { requests: [] }, success: true })
        )
      }
      if (url === "/api/client/users/resolve") {
        const body = JSON.parse(String(init?.body)) as { user_ids: string[] }
        return Promise.resolve(
          jsonResponse({
            data: {
              users: body.user_ids.map((id) => ({
                avatar: "",
                email: `${id}@example.com`,
                id,
                name: "Pending Bob",
                nickname: "",
                online: false,
                phone: "",
                type: "user",
                updated_at: "2026-08-11T00:00:00Z",
              })),
            },
            success: true,
          })
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/chat"]}>
        <ClientDataProvider>
          <FriendDirectoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("directory-mode")).toHaveTextContent("friends")
    expect(screen.getByTestId("incoming-count")).toHaveTextContent("1")
    expect(screen.getByTestId("friend-name")).toBeEmptyDOMElement()
  })

  it("batches and caches user profile resolution", async () => {
    vi.useFakeTimers()
    const resolveRequests: string[][] = []
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        const body = JSON.parse(String(init?.body)) as { user_ids: string[] }
        resolveRequests.push(body.user_ids)
        return Promise.resolve(
          jsonResponse({
            data: {
              users: body.user_ids.map((id) => ({
                avatar: "",
                email: `${id}@example.com`,
                id,
                name: id === "user-2" ? "Bob" : "Carol",
                nickname: "",
                online: false,
                phone: "",
                type: "user",
                updated_at: "2026-07-09T01:00:00Z",
              })),
            },
            success: true,
          })
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/tasks/project-1/task-1"]}>
        <ClientDataProvider>
          <UserDirectoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "resolve users" }).click())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByTestId("resolved-user")).toHaveTextContent("Bob")
    expect(resolveRequests).toEqual([["user-2", "user-3"]])

    act(() => screen.getByRole("button", { name: "resolve users" }).click())
    await act(async () => undefined)
    expect(resolveRequests).toHaveLength(1)
  })

  it("does not resolve users that were never cached when invalidated", async () => {
    vi.useFakeTimers()
    let resolveRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        resolveRequestCount += 1
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/tasks/project-1/task-1"]}>
        <ClientDataProvider>
          <UserDirectoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "invalidate user" }).click())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(resolveRequestCount).toBe(0)
  })

  it("rejects an in-flight profile response older than an invalidation event", async () => {
    vi.useFakeTimers()
    let releaseFirstResponse!: () => void
    let resolveRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        resolveRequestCount += 1
        const body = JSON.parse(String(init?.body)) as { user_ids: string[] }
        const response = jsonResponse({
          data: {
            users: body.user_ids.map((id) => ({
              avatar: "",
              email: `${id}@example.com`,
              id,
              name: resolveRequestCount === 1 ? "Old Bob" : "New Bob",
              nickname: "",
              online: false,
              phone: "",
              type: "user",
              updated_at:
                resolveRequestCount === 1
                  ? "2026-07-09T01:00:00Z"
                  : "2026-07-09T01:00:01Z",
            })),
          },
          success: true,
        })
        if (resolveRequestCount > 1) return Promise.resolve(response)
        return new Promise<Response>((resolve) => {
          releaseFirstResponse = () => resolve(response)
        })
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter initialEntries={["/tasks/project-1/task-1"]}>
        <ClientDataProvider>
          <UserDirectoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "resolve users" }).click())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => screen.getByRole("button", { name: "invalidate user" }).click())
    await act(async () => {
      releaseFirstResponse()
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(resolveRequestCount).toBe(2)
    expect(screen.getByTestId("resolved-user")).toHaveTextContent("New Bob")
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

  it("does not cache message bodies for an inactive unloaded conversation", async () => {
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
            createConversationsResponse([
              createConversationResponse("conversation-1"),
            ])
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
          <IncomingMessageCacheProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "receive inactive" }).click())
    expect(screen.getByTestId("cached-message-count")).toHaveTextContent("0")

    act(() => screen.getByRole("button", { name: "receive active" }).click())
    expect(screen.getByTestId("cached-message-count")).toHaveTextContent("1")
  })

  it("keeps realtime messages out of a focused history window", async () => {
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
        url ===
        "/api/client/conversations/conversation-1/messages?limit=20&before_seq=11"
      ) {
        return Promise.resolve(
          jsonResponse(createMessagePageResponse(1, 10, false, true))
        )
      }
      if (
        url ===
        "/api/client/conversations/conversation-1/messages?limit=20&after_seq=10"
      ) {
        return Promise.resolve(
          jsonResponse(createMessagePageResponse(11, 20, true, true))
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <FocusedHistoryProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "focus history" }).click()
    })

    expect(screen.getByTestId("focused-history-state")).toHaveTextContent(
      "history:20:0:none"
    )
    act(() => screen.getByRole("button", { name: "receive latest" }).click())
    expect(screen.getByTestId("focused-history-state")).toHaveTextContent(
      "history:20:1:message-21"
    )
  })

  it("updates a parent topic preview without caching an unopened topic", async () => {
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
            createConversationsResponse([
              createConversationResponse("parent-1"),
              createTopicConversationResponse(),
            ])
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
          <TopicPreviewCacheProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "seed topic" }).click())
    act(() =>
      screen.getByRole("button", { name: "receive topic reply" }).click()
    )

    expect(screen.getByTestId("topic-preview-reply-count")).toHaveTextContent(
      "1"
    )
    expect(screen.getByTestId("topic-cache-count")).toHaveTextContent("0")
  })

  it("enforces the retention limit after a message view is released", async () => {
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
            createConversationsResponse([
              createConversationResponse("conversation-1"),
            ])
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
          <MessageRetentionProbe />
        </ClientDataProvider>
      </MemoryRouter>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "retain messages" }).click())
    act(() => screen.getByRole("button", { name: "add 301 messages" }).click())
    expect(screen.getByTestId("retained-message-count")).toHaveTextContent(
      "301"
    )

    act(() => screen.getByRole("button", { name: "release messages" }).click())
    act(() => screen.getByRole("button", { name: "add final message" }).click())

    expect(screen.getByTestId("retained-message-count")).toHaveTextContent(
      "300"
    )
    expect(screen.getByTestId("oldest-retained-seq")).toHaveTextContent("3")
  })
})

function FriendDirectoryProbe() {
  const { contactDirectoryMode, contacts, incomingFriendRequests } =
    useClientData()
  return (
    <>
      <output data-testid="directory-mode">{contactDirectoryMode}</output>
      <output data-testid="incoming-count">
        {incomingFriendRequests.length}
      </output>
      <output data-testid="friend-name">{contacts[0]?.name}</output>
    </>
  )
}

function createFriendRequestResponse(
  id: string,
  requesterUserId: string,
  addresseeUserId: string
) {
  return {
    addressee_user_id: addresseeUserId,
    created_at: "2026-08-11T00:00:00Z",
    handled_at: null,
    id,
    requester_user_id: requesterUserId,
    status: "pending",
    updated_at: "2026-08-11T00:00:00Z",
  }
}

function UserDirectoryProbe() {
  const { ensureUsers, invalidateUsers, usersById } = useClientData()
  return (
    <>
      <button
        onClick={() => {
          void ensureUsers(["user-2", "user-3"])
          void ensureUsers(["user-3"])
        }}
        type="button"
      >
        resolve users
      </button>
      <button
        onClick={() => invalidateUsers(["user-2"], "2026-07-09T01:00:01Z")}
        type="button"
      >
        invalidate user
      </button>
      <output data-testid="resolved-user">{usersById["user-2"]?.name}</output>
    </>
  )
}

function BootstrapPreloadProbe() {
  const { conversations, getConversationMessageState, getLatestCachedMessage } =
    useClientData()
  const preloadedCount = conversations.filter(
    (conversation) => getConversationMessageState(conversation.id)?.loaded
  ).length
  return (
    <>
      <div data-testid="preloaded-count">{preloadedCount}</div>
      <div data-testid="failed-loaded">
        {String(Boolean(getConversationMessageState("conversation-3")?.loaded))}
      </div>
      <div data-testid="latest-message">
        {getLatestCachedMessage?.("conversation-31")?.id}
      </div>
    </>
  )
}

function RestoreProbe() {
  const { conversations, refreshRestoredConversation, removeConversation } =
    useClientData()
  return (
    <>
      <span data-testid="restore-action-type">
        {typeof refreshRestoredConversation}
      </span>
      <span data-testid="conversation-ids">
        {conversations.map(({ id }) => id).join(",")}
      </span>
      <button onClick={() => removeConversation("old-conversation")}>
        remove cached
      </button>
      <button
        onClick={() => void refreshRestoredConversation("old-conversation")}
      >
        remote restored
      </button>
    </>
  )
}

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

function IncomingMessageCacheProbe() {
  const { getConversationMessageState, handleIncomingConversationMessage } =
    useClientData()
  const messageCount =
    getConversationMessageState("conversation-1").messages.length

  function receiveMessage(id: string, activeConversationId: string) {
    handleIncomingConversationMessage(
      {
        body: { content: id, type: "text" },
        clientMessageId: `client-${id}`,
        conversationId: "conversation-1",
        createdAt: "2026-07-23T00:00:00Z",
        id,
        reactionVersion: 0,
        reactions: [],
        sender: { id: "user-2", type: "user" },
        seq: id === "message-1" ? 1 : 2,
      },
      { activeConversationId, visible: true }
    )
  }

  return (
    <>
      <button
        aria-label="receive inactive"
        onClick={() => receiveMessage("message-1", "conversation-2")}
        type="button"
      />
      <button
        aria-label="receive active"
        onClick={() => receiveMessage("message-2", "conversation-1")}
        type="button"
      />
      <div data-testid="cached-message-count">{messageCount}</div>
    </>
  )
}

function FocusedHistoryProbe() {
  const {
    focusConversationMessage,
    getConversationMessageState,
    getLatestCachedMessage,
    handleIncomingConversationMessage,
  } = useClientData()
  const state = getConversationMessageState("conversation-1")

  return (
    <>
      <button
        aria-label="focus history"
        onClick={() =>
          void focusConversationMessage("conversation-1", {
            messageId: "message-10",
            seq: 10,
          })
        }
        type="button"
      />
      <button
        aria-label="receive latest"
        onClick={() =>
          handleIncomingConversationMessage(
            createProbeMessage("message-21", "conversation-1", 21),
            { activeConversationId: "conversation-1", visible: true }
          )
        }
        type="button"
      />
      <div data-testid="focused-history-state">
        {state.viewMode}:{state.messages.length}:
        {state.pendingLatestMessageCount}:
        {getLatestCachedMessage?.("conversation-1")?.id ?? "none"}
      </div>
    </>
  )
}

function TopicPreviewCacheProbe() {
  const {
    getConversationMessageState,
    handleIncomingConversationMessage,
    mergeIncomingConversationMessage,
  } = useClientData()
  const parentState = getConversationMessageState("parent-1")
  const topicState = getConversationMessageState("topic-1")

  return (
    <>
      <button
        aria-label="seed topic"
        onClick={() =>
          mergeIncomingConversationMessage(
            {
              body: { content: "source", type: "text" },
              clientMessageId: "client-source",
              conversationId: "parent-1",
              createdAt: "2026-07-23T00:00:00Z",
              id: "message-1",
              reactionVersion: 0,
              reactions: [],
              sender: { id: "user-1", type: "user" },
              seq: 1,
              topic: {
                archived: false,
                conversationId: "topic-1",
                recentReplies: [],
              },
            },
            { markLoaded: true, updateList: false }
          )
        }
        type="button"
      />
      <button
        aria-label="receive topic reply"
        onClick={() =>
          handleIncomingConversationMessage(
            createProbeMessage("topic-reply-1", "topic-1", 1),
            { activeConversationId: "parent-1", visible: true }
          )
        }
        type="button"
      />
      <div data-testid="topic-preview-reply-count">
        {parentState.messages[0]?.topic?.recentReplies.length ?? 0}
      </div>
      <div data-testid="topic-cache-count">{topicState.messages.length}</div>
    </>
  )
}

function MessageRetentionProbe() {
  const {
    getConversationMessageState,
    mergeIncomingConversationMessage,
    registerConversationMessageView,
  } = useClientData()
  const releaseViewRef = React.useRef<(() => void) | null>(null)
  const state = getConversationMessageState("conversation-1")

  function mergeMessage(seq: number) {
    mergeIncomingConversationMessage(
      createProbeMessage(`message-${seq}`, "conversation-1", seq),
      { markLoaded: true, updateList: false }
    )
  }

  return (
    <>
      <button
        aria-label="retain messages"
        onClick={() => {
          releaseViewRef.current ??=
            registerConversationMessageView("conversation-1")
        }}
        type="button"
      />
      <button
        aria-label="add 301 messages"
        onClick={() => {
          for (let seq = 1; seq <= 301; seq += 1) {
            mergeMessage(seq)
          }
        }}
        type="button"
      />
      <button
        aria-label="release messages"
        onClick={() => {
          releaseViewRef.current?.()
          releaseViewRef.current = null
        }}
        type="button"
      />
      <button
        aria-label="add final message"
        onClick={() => mergeMessage(302)}
        type="button"
      />
      <div data-testid="retained-message-count">{state.messages.length}</div>
      <div data-testid="oldest-retained-seq">{state.messages[0]?.seq ?? 0}</div>
    </>
  )
}

function createProbeMessage(id: string, conversationId: string, seq: number) {
  return {
    body: { content: id, type: "text" as const },
    clientMessageId: `client-${id}`,
    conversationId,
    createdAt: `2026-07-23T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    id,
    reactionVersion: 0,
    reactions: [],
    sender: { id: "user-2", type: "user" as const },
    seq,
  }
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
      directory_mode: "organization",
      groups: [],
      user_ids: [],
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

function createMessagesResponseFor(conversationId: string) {
  const response = createMessagesResponse()
  response.data.messages[0].conversation_id = conversationId
  response.data.messages[0].id = `message-${conversationId}`
  return response
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

function createMessagePageResponse(
  firstSeq: number,
  lastSeq: number,
  hasMoreBefore: boolean,
  hasMoreAfter: boolean
) {
  return {
    data: {
      messages: Array.from({ length: lastSeq - firstSeq + 1 }, (_, index) => {
        const seq = firstSeq + index
        return {
          body: { content: `message-${seq}`, type: "text" },
          client_message_id: `client-message-${seq}`,
          conversation_id: "conversation-1",
          created_at: `2026-07-21T00:00:${String(seq).padStart(2, "0")}Z`,
          id: `message-${seq}`,
          reaction_version: 0,
          reactions: [],
          sender: { id: "user-2", type: "user" },
          seq,
        }
      }),
      page: {
        has_more_after: hasMoreAfter,
        has_more_before: hasMoreBefore,
        limit: 20,
        newest_seq: lastSeq,
        oldest_seq: firstSeq,
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
