import { StrictMode, useState } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ClientDataProvider } from "@/components/client-data-provider"
import { ClientUserDirectoryRealtimeSync } from "@/components/client-user-directory-realtime-sync"
import { useClientData } from "@/lib/client-data-context"
import { clearManagedMessageCache, configureMessageCacheTarget } from "@/lib/messages"

const targetMock = vi.hoisted(() => ({
  current: {
    id: "server-1",
    normalizedUrl: "https://chat.example.com",
    userId: "user-1",
  },
}))

vi.mock("@/hooks/use-desktop-target", () => ({
  useDesktopTarget: () => targetMock.current,
}))

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: true,
    subscribeRealtimeEvent: () => () => undefined,
  }),
}))

describe("ClientDataProvider", () => {
  afterEach(() => {
    targetMock.current = {
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    }
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
                  ],
            ),
          ),
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
      </MemoryRouter>,
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

  it("resolves ID-only contact names after StrictMode replays effects", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts") {
        return Promise.resolve(
          jsonResponse({
            data: {
              apps: [],
              directory_mode: "organization",
              groups: [],
              user_ids: ["user-2"],
            },
            success: true,
          }),
        )
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(
          jsonResponse({
            data: {
              users: [
                {
                  id: "user-2",
                  name: "Alice",
                  updated_at: "2026-08-12T00:00:00Z",
                },
              ],
            },
            success: true,
          }),
        )
      }
      if (url === "/api/client/conversations")
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      if (url === "/api/client/projects?limit=100")
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <StrictMode>
        <MemoryRouter>
          <ClientDataProvider>
            <ClientUserDirectoryRealtimeSync />
            <ContactNamesProbe />
          </ClientDataProvider>
        </MemoryRouter>
      </StrictMode>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("contact-names")).toHaveTextContent("Alice")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/client/users/resolve",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("does not resolve prior target user IDs after switching authenticated targets", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const userId = targetMock.current.userId === "user-1" ? "old-user" : "new-user"
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts") {
        return Promise.resolve(
          jsonResponse({
            data: { apps: [], directory_mode: "organization", groups: [], user_ids: [userId] },
            success: true,
          }),
        )
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        const requestedUserIds = JSON.parse(String(init?.body)).user_ids as string[]
        return Promise.resolve(
          jsonResponse({
            data: {
              users: requestedUserIds.map((id) => ({
                id,
                name: id,
                updated_at: "2026-08-12T00:00:00Z",
              })),
            },
            success: true,
          }),
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <ContactNamesProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId("contact-names")).toHaveTextContent("old-user")

    targetMock.current = {
      id: "server-2",
      normalizedUrl: "https://other-chat.example.com",
      userId: "user-2",
    }
    view.rerender(
      <MemoryRouter>
        <ClientDataProvider>
          <ContactNamesProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId("contact-names")).toHaveTextContent("new-user")

    const resolvedUserIds = fetchMock.mock.calls
      .filter(([input]) => String(input) === "/api/client/users/resolve")
      .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)).user_ids)
    expect(resolvedUserIds).toEqual([["old-user"], ["new-user"]])
  })

  it("resolves quoted-message and topic-reply senders from loaded history", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts")
        return Promise.resolve(jsonResponse(createContactsResponse()))
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
        return Promise.resolve(jsonResponse(createNestedSenderMessagesResponse()))
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <MessageSenderResolutionProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()

    await act(async () => {
      screen.getByRole("button", { name: "load nested sender messages" }).click()
    })

    await waitFor(() => {
      const resolveRequest = fetchMock.mock.calls.find(
        ([input]) => String(input) === "/api/client/users/resolve",
      )
      expect(resolveRequest).toBeDefined()
      expect(JSON.parse(String(resolveRequest?.[1]?.body))).toEqual({
        user_ids: ["message-sender", "quoted-sender", "topic-reply-sender"],
      })
    })
  })

  it("hydrates ID-only group avatar members from the user directory", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts") {
        return Promise.resolve(
          jsonResponse({
            data: {
              apps: [],
              directory_mode: "organization",
              groups: [
                {
                  avatar_members: [{ id: "user-2", role: "owner", type: "user" }],
                  id: "group-1",
                  name: "产品讨论组",
                },
              ],
              user_ids: [],
            },
            success: true,
          }),
        )
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(
            createConversationsResponse([
              {
                created_at: "2026-08-12T00:00:00Z",
                id: "group-1",
                members: [{ id: "user-2", role: "owner", type: "user" }],
                name: "产品讨论组",
                type: "group",
              },
            ]),
          ),
        )
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(
          jsonResponse({
            data: {
              users: [
                {
                  avatar: "/avatars/alice.webp",
                  id: "user-2",
                  name: "Alice",
                  nickname: "A",
                  updated_at: "2026-08-12T00:00:00Z",
                },
              ],
            },
            success: true,
          }),
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
          <GroupAvatarMembersProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("contact-group-avatar-member")).toHaveTextContent(
      "Alice|A|/avatars/alice.webp",
    )
    expect(screen.getByTestId("conversation-avatar-member")).toHaveTextContent(
      "Alice|A|/avatars/alice.webp",
    )

    const resolveRequests = fetchMock.mock.calls.filter(
      ([input]) => String(input) === "/api/client/users/resolve",
    )
    expect(resolveRequests).toHaveLength(1)
    expect(JSON.parse(String(resolveRequests[0]?.[1]?.body))).toEqual({ user_ids: ["user-2"] })
  })

  it("keeps the newest contacts when concurrent refreshes resolve out of order", async () => {
    vi.useFakeTimers()
    const olderRefresh = createDeferred<Response>()
    const newerRefresh = createDeferred<Response>()
    let contactsRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        contactsRequestCount += 1
        if (contactsRequestCount === 1) {
          return Promise.resolve(jsonResponse(createContactsResponseWithUsers(["initial-user"])))
        }
        return contactsRequestCount === 2 ? olderRefresh.promise : newerRefresh.promise
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
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
          <ContactRefreshRaceProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId("contact-ids")).toHaveTextContent("initial-user")

    act(() => screen.getByRole("button", { name: "refresh contacts" }).click())
    act(() => screen.getByRole("button", { name: "refresh contacts" }).click())
    expect(contactsRequestCount).toBe(3)

    await act(async () => {
      newerRefresh.resolve(jsonResponse(createContactsResponseWithUsers(["new-user"])))
    })
    expect(screen.getByTestId("contact-ids")).toHaveTextContent("new-user")

    await act(async () => {
      olderRefresh.resolve(jsonResponse(createContactsResponseWithUsers(["old-user"])))
    })
    expect(screen.getByTestId("contact-ids")).toHaveTextContent("new-user")
  })

  it("直接刷新通讯录切换到 friends 模式后加载待处理申请", async () => {
    vi.useFakeTimers()
    let contactsRequestCount = 0
    let incomingRequestCount = 0
    let outgoingRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        contactsRequestCount += 1
        return Promise.resolve(
          jsonResponse(
            contactsRequestCount === 1
              ? createContactsResponse()
              : createFriendsContactsResponse([]),
          ),
        )
      }
      if (url === "/api/client/friend-requests?direction=incoming") {
        incomingRequestCount += 1
        return Promise.resolve(jsonResponse(createFriendRequestsResponse(["request-incoming"])))
      }
      if (url === "/api/client/friend-requests?direction=outgoing") {
        outgoingRequestCount += 1
        return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ContactRefreshFriendDataProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId("contact-directory-mode")).toHaveTextContent("organization")
    expect(incomingRequestCount).toBe(0)
    expect(outgoingRequestCount).toBe(0)

    await act(async () => {
      screen.getByRole("button", { name: "refresh contacts" }).click()
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByTestId("contact-directory-mode")).toHaveTextContent("friends")
    expect(screen.getByTestId("incoming-request-ids")).toHaveTextContent("request-incoming")
    expect(incomingRequestCount).toBe(1)
    expect(outgoingRequestCount).toBe(1)
  })

  it("keeps the newest friend requests when concurrent refreshes resolve out of order", async () => {
    vi.useFakeTimers()
    const olderIncoming = createDeferred<Response>()
    const olderOutgoing = createDeferred<Response>()
    const newerIncoming = createDeferred<Response>()
    const newerOutgoing = createDeferred<Response>()
    let incomingRequestCount = 0
    let outgoingRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
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
          }),
        )
      }
      if (url === "/api/client/friend-requests?direction=incoming") {
        incomingRequestCount += 1
        if (incomingRequestCount === 1) {
          return Promise.resolve(jsonResponse(createFriendRequestsResponse(["initial-incoming"])))
        }
        return incomingRequestCount === 2 ? olderIncoming.promise : newerIncoming.promise
      }
      if (url === "/api/client/friend-requests?direction=outgoing") {
        outgoingRequestCount += 1
        if (outgoingRequestCount === 1) {
          return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
        }
        return outgoingRequestCount === 2 ? olderOutgoing.promise : newerOutgoing.promise
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <FriendRequestRefreshRaceProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(screen.getByTestId("incoming-request-ids")).toHaveTextContent("initial-incoming")

    act(() => screen.getByRole("button", { name: "refresh friend requests" }).click())
    act(() => screen.getByRole("button", { name: "refresh friend requests" }).click())
    expect(incomingRequestCount).toBe(3)
    expect(outgoingRequestCount).toBe(3)

    await act(async () => {
      newerIncoming.resolve(jsonResponse(createFriendRequestsResponse(["new-incoming"])))
      newerOutgoing.resolve(jsonResponse(createFriendRequestsResponse([])))
    })
    expect(screen.getByTestId("incoming-request-ids")).toHaveTextContent("new-incoming")

    await act(async () => {
      olderIncoming.resolve(jsonResponse(createFriendRequestsResponse(["old-incoming"])))
      olderOutgoing.resolve(jsonResponse(createFriendRequestsResponse([])))
    })
    expect(screen.getByTestId("incoming-request-ids")).toHaveTextContent("new-incoming")
  })

  it("refreshes the friend directory immediately when a reciprocal request is accepted", async () => {
    vi.useFakeTimers()
    let contactsRequestCount = 0
    let incomingRequestCount = 0
    let outgoingRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        contactsRequestCount += 1
        return Promise.resolve(
          jsonResponse(
            createFriendsContactsResponse(contactsRequestCount === 1 ? [] : ["friend-user"]),
          ),
        )
      }
      if (url === "/api/client/friend-requests?direction=incoming") {
        incomingRequestCount += 1
        return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
      }
      if (url === "/api/client/friend-requests?direction=outgoing") {
        outgoingRequestCount += 1
        return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
      }
      if (url === "/api/client/friend-requests" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ data: createFriendRequestResponse(), success: true }))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/users/resolve") {
        return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <FriendMutationProbe action="create" />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(incomingRequestCount).toBe(1)
    const contactsBeforeMutation = contactsRequestCount
    const incomingBeforeMutation = incomingRequestCount
    const outgoingBeforeMutation = outgoingRequestCount

    await act(async () => {
      screen.getByRole("button", { name: "create friend mutation" }).click()
    })

    expect(screen.getByTestId("friend-mutation-result")).toHaveTextContent("success")
    expect(screen.getByTestId("friend-mutation-contact-ids")).toHaveTextContent("friend-user")
    expect(contactsRequestCount).toBe(contactsBeforeMutation + 1)
    expect(incomingRequestCount).toBe(incomingBeforeMutation + 1)
    expect(outgoingRequestCount).toBe(outgoingBeforeMutation + 1)
  })

  it.each([
    ["reject", "/api/client/friend-requests/request-1/reject"],
    ["cancel", "/api/client/friend-requests/request-1"],
    ["delete", "/api/client/friends/friend-user"],
  ] as const)(
    "refreshes friend data after a successful %s mutation",
    async (action, mutationUrl) => {
      vi.useFakeTimers()
      let contactsRequestCount = 0
      let incomingRequestCount = 0
      let outgoingRequestCount = 0
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/client/me") {
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        }
        if (url === "/api/client/contacts") {
          contactsRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendsContactsResponse(["friend-user"])))
        }
        if (url === "/api/client/friend-requests?direction=incoming") {
          incomingRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
        }
        if (url === "/api/client/friend-requests?direction=outgoing") {
          outgoingRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
        }
        if (
          url === mutationUrl &&
          init?.method === (action === "cancel" || action === "delete" ? "DELETE" : "POST")
        ) {
          return Promise.resolve(
            jsonResponse({ data: createFriendRequestResponse(), success: true }),
          )
        }
        if (url === "/api/client/conversations") {
          return Promise.resolve(jsonResponse(createConversationsResponse([])))
        }
        if (url === "/api/client/projects?limit=100") {
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        }
        if (url === "/api/client/users/resolve") {
          return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      })
      vi.stubGlobal("fetch", fetchMock)

      render(
        <MemoryRouter>
          <ClientDataProvider>
            <FriendMutationProbe action={action} />
          </ClientDataProvider>
        </MemoryRouter>,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(incomingRequestCount).toBe(1)
      const contactsBeforeMutation = contactsRequestCount
      const incomingBeforeMutation = incomingRequestCount
      const outgoingBeforeMutation = outgoingRequestCount

      await act(async () => {
        screen.getByRole("button", { name: `${action} friend mutation` }).click()
      })

      expect(screen.getByTestId("friend-mutation-result")).toHaveTextContent("success")
      expect(contactsRequestCount).toBe(contactsBeforeMutation + 1)
      expect(incomingRequestCount).toBe(incomingBeforeMutation + 1)
      expect(outgoingRequestCount).toBe(outgoingBeforeMutation + 1)
    },
  )

  it.each([
    ["create", "/api/client/friend-requests", "POST"],
    ["accept", "/api/client/friend-requests/request-1/accept", "POST"],
    ["reject", "/api/client/friend-requests/request-1/reject", "POST"],
    ["cancel", "/api/client/friend-requests/request-1", "DELETE"],
    ["delete", "/api/client/friends/friend-user", "DELETE"],
  ] as const)(
    "reconciles friend data after a failed %s mutation",
    async (action, mutationUrl, mutationMethod) => {
      vi.useFakeTimers()
      let contactsRequestCount = 0
      let incomingRequestCount = 0
      let outgoingRequestCount = 0
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "/api/client/me") {
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        }
        if (url === "/api/client/contacts") {
          contactsRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendsContactsResponse(["friend-user"])))
        }
        if (url === "/api/client/friend-requests?direction=incoming") {
          incomingRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendRequestsResponse(["request-1"])))
        }
        if (url === "/api/client/friend-requests?direction=outgoing") {
          outgoingRequestCount += 1
          return Promise.resolve(jsonResponse(createFriendRequestsResponse([])))
        }
        if (url === mutationUrl && init?.method === mutationMethod) {
          return Promise.resolve(jsonErrorResponse("关系状态已变化"))
        }
        if (url === "/api/client/conversations") {
          return Promise.resolve(jsonResponse(createConversationsResponse([])))
        }
        if (url === "/api/client/projects?limit=100") {
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        }
        if (url === "/api/client/users/resolve") {
          return Promise.resolve(jsonResponse({ data: { users: [] }, success: true }))
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      })
      vi.stubGlobal("fetch", fetchMock)

      render(
        <MemoryRouter>
          <ClientDataProvider>
            <FriendMutationProbe action={action} />
          </ClientDataProvider>
        </MemoryRouter>,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(incomingRequestCount).toBe(1)
      const contactsBeforeMutation = contactsRequestCount
      const incomingBeforeMutation = incomingRequestCount
      const outgoingBeforeMutation = outgoingRequestCount

      await act(async () => {
        screen.getByRole("button", { name: `${action} friend mutation` }).click()
      })

      expect(screen.getByTestId("friend-mutation-result")).toHaveTextContent("关系状态已变化")
      expect(contactsRequestCount).toBe(contactsBeforeMutation + 1)
      expect(incomingRequestCount).toBe(incomingBeforeMutation + 1)
      expect(outgoingRequestCount).toBe(outgoingBeforeMutation + 1)
    },
  )

  it("shows the workspace error page and recovers after retrying", async () => {
    vi.useFakeTimers()
    let shouldFail = true
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)

      if (shouldFail) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "workspace_unavailable",
                message: "暂时无法连接到工作区服务",
              },
              success: false,
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 503,
            },
          ),
        )
      }

      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(jsonResponse(createConversationsResponse([])))
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }

      return Promise.reject(new Error(`unexpected request: ${url}`))
    })

    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider workspaceErrorAction={<button type="button">新版本</button>}>
          <div>工作区内容</div>
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByRole("heading", { name: "工作区加载失败" })).toBeVisible()
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法连接到工作区服务")
    expect(screen.getByRole("complementary", { name: "连接检查" })).toBeVisible()
    expect(screen.getByAltText("即应")).toBeVisible()
    expect(screen.getByRole("button", { name: "新版本" })).toBeVisible()

    shouldFail = false
    screen.getByRole("button", { name: "重新加载" }).click()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByText("工作区内容")).toBeVisible()
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
          jsonResponse(createConversationsResponse([createTopicConversationResponse()])),
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
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("topic-count")).toHaveTextContent("1")
    act(() => screen.getByRole("button", { name: "archive topic" }).click())
    expect(screen.getByTestId("topic-count")).toHaveTextContent("0")
  })

  it("updates conversation mute state after the API succeeds", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/mute") {
        expect(init?.method).toBe("PUT")
        return Promise.resolve(
          jsonResponse({
            data: { conversation_id: "conversation-1", muted: true },
            success: true,
          }),
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationMuteProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("mute-state")).toHaveTextContent("active")

    await act(async () => {
      screen.getByRole("button", { name: "mute conversation" }).click()
    })

    expect(screen.getByTestId("mute-state")).toHaveTextContent("muted")
  })

  it("updates a group conversation sender from an incoming realtime message", async () => {
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
          jsonResponse(createConversationsResponse([createGroupConversationResponse()])),
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
          <GroupRealtimeMessageProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("group-preview")).toHaveTextContent("无发送者：")
    act(() => screen.getByRole("button", { name: "receive group message" }).click())
    expect(screen.getByTestId("group-preview")).toHaveTextContent("小张：方案已经更新")
    expect(screen.getByTestId("group-message-count")).toHaveTextContent("0")

    act(() => screen.getByRole("button", { name: "receive active group message" }).click())
    expect(screen.getByTestId("group-message-count")).toHaveTextContent("1")
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
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
        return Promise.resolve(jsonResponse(createMessagesResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/messages/reactions/query") {
        snapshotRequestCount += 1
        return Promise.resolve(
          jsonResponse(
            createReactionSnapshotsResponse(
              snapshotRequestCount === 1 ? 3 : 4,
              snapshotRequestCount === 1 ? "👍" : "🎉",
            ),
          ),
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
      </MemoryRouter>,
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

  it("clears retained messages on dismiss and restores without duplicate rows", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
        return Promise.resolve(jsonResponse(createMessagesResponse()))
      }
      if (url === "/api/client/conversations/conversation-1" && init?.method === "DELETE") {
        expect(init.method).toBe("DELETE")
        return Promise.resolve(
          jsonResponse({ data: { conversation_id: "conversation-1" }, success: true }),
        )
      }
      if (url === "/api/client/conversations/conversation-1/restore") {
        expect(init?.method).toBe("POST")
        return Promise.resolve(
          jsonResponse({
            data: { conversation: createConversationResponse("conversation-1") },
            success: true,
          }),
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationLifecycleProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load lifecycle messages" }).click()
    })
    expect(screen.getByTestId("lifecycle-state")).toHaveTextContent("1:1")

    await act(async () => {
      screen.getByRole("button", { name: "dismiss lifecycle conversation" }).click()
    })
    expect(screen.getByTestId("lifecycle-state")).toHaveTextContent("0:0")

    await act(async () => {
      screen.getByRole("button", { name: "restore lifecycle conversation" }).click()
      screen.getByRole("button", { name: "restore lifecycle conversation" }).click()
    })
    expect(screen.getByTestId("lifecycle-state")).toHaveTextContent("1:0")
  })

  it("为设置页注册保留当前工作集的 Manager 缓存清理", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    vi.stubGlobal("desktop", { messageCache })
    const target = {
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    }
    const restoreTarget = configureMessageCacheTarget(target)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "/api/client/me")
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        if (url === "/api/client/contacts")
          return Promise.resolve(jsonResponse(createContactsResponse()))
        if (url === "/api/client/conversations")
          return Promise.resolve(jsonResponse(createConversationsResponse([])))
        if (url === "/api/client/projects?limit=100")
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        return Promise.reject(new Error(`unexpected request: ${url}`))
      }),
    )

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <div>ready</div>
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    await expect(clearManagedMessageCache(target)).resolves.toBe(true)
    expect(messageCache.clearUser).toHaveBeenCalledWith(target)

    view.unmount()
    restoreTarget()
  })

  it("清理持久缓存后保留当前消息并从 Server 加载更早历史", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    messageCache.readBefore.mockResolvedValue({
      complete: false,
      hasMoreBefore: true,
      messages: [],
      newestSeq: 0,
      oldestSeq: 0,
    })
    vi.stubGlobal("desktop", { messageCache })
    const target = {
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    }
    const restoreTarget = configureMessageCacheTarget(target)
    let beforeRequestCount = 0
    let latestRequestCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "/api/client/me")
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        if (url === "/api/client/contacts")
          return Promise.resolve(jsonResponse(createContactsResponse()))
        if (url === "/api/client/conversations")
          return Promise.resolve(
            jsonResponse(
              createConversationsResponse([createConversationResponse("conversation-1")]),
            ),
          )
        if (url === "/api/client/projects?limit=100")
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
          latestRequestCount += 1
          return Promise.resolve(jsonResponse(createMessagesResponse(21, true)))
        }
        if (url === "/api/client/conversations/conversation-1/messages?limit=20&before_seq=21") {
          beforeRequestCount += 1
          return Promise.resolve(jsonResponse(createMessagesResponse(1, false)))
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      }),
    )

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <MessagePaginationProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("1:more")

    await act(async () => {
      await clearManagedMessageCache(target)
    })
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("1:more")

    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(latestRequestCount).toBe(2)
    expect(messageCache.commitLatest).toHaveBeenCalledTimes(2)

    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(latestRequestCount).toBe(2)

    await act(async () => {
      screen.getByRole("button", { name: "load older messages" }).click()
    })
    expect(beforeRequestCount).toBe(1)
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("2:end")

    view.unmount()
    restoreTarget()
  })

  it("最近消息缓存读取失败时提示降级并继续从 Server 加载", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    messageCache.readRecent.mockRejectedValue(new Error("cache unavailable"))
    vi.stubGlobal("desktop", { messageCache })
    const restoreTarget = configureMessageCacheTarget({
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts")
        return Promise.resolve(jsonResponse(createContactsResponse()))
      if (url === "/api/client/conversations")
        return Promise.resolve(
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      if (url === "/api/client/projects?limit=100")
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      if (url === "/api/client/conversations/conversation-1/messages?limit=20")
        return Promise.resolve(jsonResponse(createMessagesResponse(1, true)))
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <MessagePaginationProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })

    expect(screen.getByTestId("pagination-state")).toHaveTextContent("1:more")
    expect(screen.getByTestId("pagination-load-state")).toHaveTextContent("loaded:idle")
    expect(screen.getByTestId("pagination-error")).toHaveTextContent(
      "本地消息缓存暂时不可用，已从服务器加载",
    )
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/client/conversations/conversation-1/messages?limit=20",
    )

    view.unmount()
    restoreTarget()
  })

  it("历史消息缓存读取失败时提示降级并继续从 Server 加载", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    messageCache.readBefore.mockRejectedValue(new Error("cache unavailable"))
    vi.stubGlobal("desktop", { messageCache })
    const restoreTarget = configureMessageCacheTarget({
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    })
    let beforeRequestCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "/api/client/me")
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        if (url === "/api/client/contacts")
          return Promise.resolve(jsonResponse(createContactsResponse()))
        if (url === "/api/client/conversations")
          return Promise.resolve(
            jsonResponse(
              createConversationsResponse([createConversationResponse("conversation-1")]),
            ),
          )
        if (url === "/api/client/projects?limit=100")
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        if (url === "/api/client/conversations/conversation-1/messages?limit=20")
          return Promise.resolve(jsonResponse(createMessagesResponse(21, true)))
        if (url === "/api/client/conversations/conversation-1/messages?limit=20&before_seq=21") {
          beforeRequestCount += 1
          return Promise.resolve(jsonResponse(createMessagesResponse(1, false)))
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      }),
    )

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <MessagePaginationProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    await act(async () => {
      screen.getByRole("button", { name: "load older messages" }).click()
    })

    expect(beforeRequestCount).toBe(1)
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("2:end")
    expect(screen.getByTestId("pagination-error")).toHaveTextContent(
      "本地消息缓存暂时不可用，已从服务器加载",
    )

    view.unmount()
    restoreTarget()
  })

  it("清理后的 Server 校准失败时保留当前消息并在下次进入重试", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    vi.stubGlobal("desktop", { messageCache })
    const target = {
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    }
    const restoreTarget = configureMessageCacheTarget(target)
    let latestRequestCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "/api/client/me")
          return Promise.resolve(jsonResponse(createCurrentUserResponse()))
        if (url === "/api/client/contacts")
          return Promise.resolve(jsonResponse(createContactsResponse()))
        if (url === "/api/client/conversations")
          return Promise.resolve(
            jsonResponse(
              createConversationsResponse([createConversationResponse("conversation-1")]),
            ),
          )
        if (url === "/api/client/projects?limit=100")
          return Promise.resolve(jsonResponse(createProjectsResponse()))
        if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
          latestRequestCount += 1
          if (latestRequestCount === 2) return Promise.reject(new Error("network unavailable"))
          return Promise.resolve(
            jsonResponse(createMessagesResponse(latestRequestCount === 1 ? 1 : 2, true)),
          )
        }
        return Promise.reject(new Error(`unexpected request: ${url}`))
      }),
    )

    const view = render(
      <MemoryRouter>
        <ClientDataProvider>
          <MessagePaginationProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("1:more")

    await act(async () => {
      await clearManagedMessageCache(target)
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(latestRequestCount).toBe(2)
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("1:more")
    expect(screen.getByTestId("pagination-load-state")).toHaveTextContent("loaded:idle")

    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(latestRequestCount).toBe(3)
    expect(screen.getByTestId("pagination-state")).toHaveTextContent("2:more")

    await act(async () => {
      screen.getByRole("button", { name: "load paged messages" }).click()
    })
    expect(latestRequestCount).toBe(3)

    view.unmount()
    restoreTarget()
  })

  it("会话移除后忽略更早发出的消息响应", async () => {
    vi.useFakeTimers()
    const messagesResponse = createDeferred<Response>()
    const messageCache = createMessageCacheMock()
    vi.stubGlobal("desktop", { messageCache })
    const restoreTarget = configureMessageCacheTarget({
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        return Promise.resolve(
          jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
        )
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1/messages?limit=20") {
        return messagesResponse.promise
      }
      if (url === "/api/client/conversations/conversation-1" && init?.method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ data: { conversation_id: "conversation-1" }, success: true }),
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationLifecycleProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "load lifecycle messages" }).click())
    await act(async () => undefined)
    await act(async () => {
      screen.getByRole("button", { name: "dismiss lifecycle conversation" }).click()
    })
    expect(screen.getByTestId("lifecycle-state")).toHaveTextContent("0:0")

    await act(async () => {
      messagesResponse.resolve(jsonResponse(createMessagesResponse()))
    })

    expect(screen.getByTestId("lifecycle-state")).toHaveTextContent("0:0")
    expect(messageCache.commitLatest).not.toHaveBeenCalled()
    expect(messageCache.clearConversation).toHaveBeenCalledOnce()
    restoreTarget()
  })

  it("does not restore a dismissed conversation from an older refresh", async () => {
    vi.useFakeTimers()
    const staleRefresh = createDeferred<Response>()
    let conversationRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        conversationRequestCount += 1
        if (conversationRequestCount === 1) {
          return Promise.resolve(
            jsonResponse(
              createConversationsResponse([createConversationResponse("conversation-1")]),
            ),
          )
        }
        return staleRefresh.promise
      }
      if (url === "/api/client/projects?limit=100") {
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      }
      if (url === "/api/client/conversations/conversation-1" && init?.method === "DELETE") {
        return Promise.resolve(
          jsonResponse({ data: { conversation_id: "conversation-1" }, success: true }),
        )
      }
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationRefreshRaceProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(screen.getByTestId("conversation-ids")).toHaveTextContent("conversation-1")
    act(() => screen.getByRole("button", { name: "refresh conversations" }).click())
    expect(conversationRequestCount).toBe(2)

    await act(async () => {
      screen.getByRole("button", { name: "dismiss conversation" }).click()
    })
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent("none")

    await act(async () => {
      staleRefresh.resolve(
        jsonResponse(createConversationsResponse([createConversationResponse("conversation-1")])),
      )
    })
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent("none")
  })

  it("keeps the newest result when concurrent conversation refreshes resolve out of order", async () => {
    vi.useFakeTimers()
    const olderRefresh = createDeferred<Response>()
    const newerRefresh = createDeferred<Response>()
    let conversationRequestCount = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me") {
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      }
      if (url === "/api/client/contacts") {
        return Promise.resolve(jsonResponse(createContactsResponse()))
      }
      if (url === "/api/client/conversations") {
        conversationRequestCount += 1
        if (conversationRequestCount === 1) {
          return Promise.resolve(
            jsonResponse(createConversationsResponse([createConversationResponse("initial")])),
          )
        }
        return conversationRequestCount === 2 ? olderRefresh.promise : newerRefresh.promise
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
          <ConversationRefreshRaceProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    act(() => screen.getByRole("button", { name: "refresh conversations" }).click())
    act(() => screen.getByRole("button", { name: "refresh conversations" }).click())
    expect(conversationRequestCount).toBe(3)

    await act(async () => {
      newerRefresh.resolve(
        jsonResponse(createConversationsResponse([createConversationResponse("newest")])),
      )
    })
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent("newest")

    await act(async () => {
      olderRefresh.resolve(
        jsonResponse(createConversationsResponse([createConversationResponse("older")])),
      )
    })
    expect(screen.getByTestId("conversation-ids")).toHaveTextContent("newest")
  })

  it("会话列表发现持久游标缺口时自动从 after_seq 追赶", async () => {
    vi.useFakeTimers()
    const messageCache = createMessageCacheMock()
    const generation = { conversation: 0, global: 0, server: 0, user: 0 }
    messageCache.getSyncState.mockResolvedValue({
      conversationId: "conversation-1",
      generation,
      hasMoreBefore: true,
      httpSyncedThroughSeq: 299,
      lastAccessedAt: 0,
    })
    messageCache.listSyncStates.mockResolvedValue([
      {
        conversationId: "conversation-1",
        generation,
        hasMoreBefore: true,
        httpSyncedThroughSeq: 299,
        lastAccessedAt: 0,
      },
    ])
    messageCache.commitAfter.mockResolvedValue({ committed: true, committedSeq: 325, generation })
    vi.stubGlobal("desktop", { messageCache })
    const restoreTarget = configureMessageCacheTarget({
      id: "server-1",
      normalizedUrl: "https://chat.example.com",
      userId: "user-1",
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/client/me")
        return Promise.resolve(jsonResponse(createCurrentUserResponse()))
      if (url === "/api/client/contacts")
        return Promise.resolve(jsonResponse(createContactsResponse()))
      if (url === "/api/client/conversations")
        return Promise.resolve(
          jsonResponse(
            createConversationsResponse([
              { ...createConversationResponse("conversation-1"), last_message_seq: 325 },
            ]),
          ),
        )
      if (url === "/api/client/projects?limit=100")
        return Promise.resolve(jsonResponse(createProjectsResponse()))
      if (url === "/api/client/conversations/conversation-1/messages?limit=20&after_seq=299")
        return Promise.resolve(jsonResponse(createMessagesResponse(325)))
      return Promise.reject(new Error(`unexpected request: ${url}`))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(
      <MemoryRouter>
        <ClientDataProvider>
          <ConversationRefreshRaceProbe />
        </ClientDataProvider>
      </MemoryRouter>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    act(() => screen.getByRole("button", { name: "refresh conversations" }).click())

    await waitFor(() => expect(messageCache.listSyncStates).toHaveBeenCalled())
    await waitFor(() => expect(messageCache.commitAfter).toHaveBeenCalledOnce())
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/client/conversations/conversation-1/messages?limit=20&after_seq=299",
    )
    restoreTarget()
  })
})

function ConversationCount() {
  const { conversations } = useClientData()

  return <div data-testid="conversation-count">{conversations.length}</div>
}

function ConversationRefreshRaceProbe() {
  const { conversations, dismissConversation, refreshConversations } = useClientData()

  return (
    <>
      <button
        aria-label="refresh conversations"
        onClick={() => void refreshConversations()}
        type="button"
      />
      <button
        aria-label="dismiss conversation"
        onClick={() => void dismissConversation("conversation-1")}
        type="button"
      />
      <div data-testid="conversation-ids">
        {conversations.map((conversation) => conversation.id).join(",") || "none"}
      </div>
    </>
  )
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

function ConversationMuteProbe() {
  const { conversations, setConversationMuted } = useClientData()
  const conversation = conversations[0]

  return (
    <>
      <button
        aria-label="mute conversation"
        onClick={() => void setConversationMuted(conversation.id, true)}
        type="button"
      />
      <div data-testid="mute-state">{conversation.notificationMuted ? "muted" : "active"}</div>
    </>
  )
}

function ConversationLifecycleProbe() {
  const {
    conversations,
    dismissConversation,
    ensureConversationMessages,
    getConversationMessageState,
    restoreConversation,
  } = useClientData()

  return (
    <>
      <button
        aria-label="load lifecycle messages"
        onClick={() => ensureConversationMessages("conversation-1")}
        type="button"
      />
      <button
        aria-label="dismiss lifecycle conversation"
        onClick={() => void dismissConversation("conversation-1")}
        type="button"
      />
      <button
        aria-label="restore lifecycle conversation"
        onClick={() => void restoreConversation("conversation-1")}
        type="button"
      />
      <div data-testid="lifecycle-state">
        {conversations.length}:{getConversationMessageState("conversation-1").messages.length}
      </div>
    </>
  )
}

function MessagePaginationProbe() {
  const {
    ensureConversationMessages,
    getConversationMessageState,
    loadBeforeConversationMessages,
  } = useClientData()
  const state = getConversationMessageState("conversation-1")

  return (
    <>
      <button
        aria-label="load paged messages"
        onClick={() => ensureConversationMessages("conversation-1")}
        type="button"
      />
      <button
        aria-label="load older messages"
        onClick={() => loadBeforeConversationMessages("conversation-1")}
        type="button"
      />
      <div data-testid="pagination-state">
        {state.messages.length}:{state.page?.hasMoreBefore ? "more" : "end"}
      </div>
      <div data-testid="pagination-load-state">
        {state.loaded ? "loaded" : "unloaded"}:{state.loading ? "loading" : "idle"}
      </div>
      <div data-testid="pagination-error">{state.error ?? "none"}</div>
    </>
  )
}

function ContactNamesProbe() {
  const { contacts } = useClientData()
  return <div data-testid="contact-names">{contacts.map((contact) => contact.name).join(",")}</div>
}

function ContactRefreshRaceProbe() {
  const { contacts, refreshContacts } = useClientData()

  return (
    <>
      <button aria-label="refresh contacts" onClick={() => void refreshContacts()} type="button" />
      <div data-testid="contact-ids">{contacts.map((contact) => contact.id).join(",")}</div>
    </>
  )
}

function FriendRequestRefreshRaceProbe() {
  const { incomingFriendRequests = [], refreshFriendData } = useClientData()

  return (
    <>
      <button
        aria-label="refresh friend requests"
        onClick={() => void refreshFriendData({ includeContacts: false })}
        type="button"
      />
      <div data-testid="incoming-request-ids">
        {incomingFriendRequests.map((request) => request.id).join(",")}
      </div>
    </>
  )
}

function ContactRefreshFriendDataProbe() {
  const { contactDirectoryMode, incomingFriendRequests = [], refreshContacts } = useClientData()

  return (
    <>
      <button aria-label="refresh contacts" onClick={() => void refreshContacts()} type="button" />
      <div data-testid="contact-directory-mode">{contactDirectoryMode}</div>
      <div data-testid="incoming-request-ids">
        {incomingFriendRequests.map((request) => request.id).join(",")}
      </div>
    </>
  )
}

type FriendMutationAction = "accept" | "cancel" | "create" | "delete" | "reject"

function FriendMutationProbe({ action }: { action: FriendMutationAction }) {
  const {
    acceptFriendRequest,
    cancelFriendRequest,
    contacts,
    createFriendRequest,
    deleteFriend,
    incomingFriendRequests = [],
    outgoingFriendRequests = [],
    rejectFriendRequest,
  } = useClientData()
  const [result, setResult] = useState("idle")

  const mutations = {
    accept: () => acceptFriendRequest?.("request-1"),
    cancel: () => cancelFriendRequest?.("request-1"),
    create: () => createFriendRequest?.("friend-user"),
    delete: () => deleteFriend?.("friend-user"),
    reject: () => rejectFriendRequest?.("request-1"),
  }

  async function runMutation() {
    try {
      const mutation = mutations[action]()
      if (!mutation) {
        throw new Error("好友操作不可用")
      }
      await mutation
      setResult("success")
    } catch (error) {
      setResult(error instanceof Error ? error.message : "failed")
    }
  }

  return (
    <>
      <button
        aria-label={`${action} friend mutation`}
        onClick={() => void runMutation()}
        type="button"
      />
      <div data-testid="friend-mutation-result">{result}</div>
      <div data-testid="friend-mutation-contact-ids">
        {contacts.map((contact) => contact.id).join(",")}
      </div>
      <div data-testid="friend-mutation-incoming-ids">
        {incomingFriendRequests.map((request) => request.id).join(",")}
      </div>
      <div data-testid="friend-mutation-outgoing-ids">
        {outgoingFriendRequests.map((request) => request.id).join(",")}
      </div>
    </>
  )
}

function GroupAvatarMembersProbe() {
  const { contactGroups, conversations } = useClientData()
  const contactMember = contactGroups[0]?.avatarMembers[0]
  const conversationMember = conversations[0]?.members?.[0]

  return (
    <>
      <div data-testid="contact-group-avatar-member">
        {contactMember
          ? `${contactMember.name}|${contactMember.nickname}|${contactMember.avatar}`
          : "missing"}
      </div>
      <div data-testid="conversation-avatar-member">
        {conversationMember
          ? `${conversationMember.name}|${conversationMember.nickname}|${conversationMember.avatar}`
          : "missing"}
      </div>
    </>
  )
}

function GroupRealtimeMessageProbe() {
  const { conversations, getConversationMessageState, handleIncomingConversationMessage } =
    useClientData()
  const conversation = conversations[0]
  const sender = conversation?.lastMessageSender

  return (
    <>
      <button
        aria-label="receive active group message"
        onClick={() =>
          handleIncomingConversationMessage(
            {
              body: { content: "活动会话消息", type: "text" },
              clientMessageId: "client-message-live-2",
              conversationId: "group-1",
              createdAt: "2026-07-28T01:01:00Z",
              id: "message-live-2",
              reactionVersion: 0,
              reactions: [],
              sender: { id: "user-2", type: "user" },
              seq: 2,
            },
            { activeConversationId: "group-1", visible: true },
          )
        }
        type="button"
      />
      <button
        aria-label="receive group message"
        onClick={() =>
          handleIncomingConversationMessage({
            body: { content: "方案已经更新", type: "text" },
            clientMessageId: "client-message-live-1",
            conversationId: "group-1",
            createdAt: "2026-07-28T01:00:00Z",
            id: "message-live-1",
            reactionVersion: 0,
            reactions: [],
            sender: { id: "user-2", type: "user" },
            seq: 1,
          })
        }
        type="button"
      />
      <div data-testid="group-preview">
        {sender?.nickname || sender?.name || "无发送者"}：{conversation?.lastMessageSummary}
      </div>
      <div data-testid="group-message-count">
        {getConversationMessageState("group-1").messages.length}
      </div>
    </>
  )
}

function MessageSenderResolutionProbe() {
  const { ensureConversationMessages } = useClientData()
  return (
    <button
      aria-label="load nested sender messages"
      onClick={() => void ensureConversationMessages("conversation-1")}
      type="button"
    />
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

function jsonErrorResponse(message: string) {
  return new Response(
    JSON.stringify({
      error: {
        code: "friend_state_changed",
        message,
      },
      success: false,
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
      status: 409,
    },
  )
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

function createMessageCacheMock() {
  const generation = { conversation: 0, global: 0, server: 0, user: 0 }
  return {
    clearUser: vi.fn().mockResolvedValue(undefined),
    clearConversation: vi.fn().mockResolvedValue({ ...generation, conversation: 1 }),
    commitAfter: vi.fn().mockResolvedValue({ committed: true, committedSeq: 0, generation }),
    commitBefore: vi.fn(),
    commitLatest: vi.fn().mockResolvedValue({
      committed: true,
      committedSeq: 21,
      generation,
    }),
    getSyncState: vi.fn().mockResolvedValue({
      conversationId: "conversation-1",
      generation,
      hasMoreBefore: true,
      httpSyncedThroughSeq: 0,
      lastAccessedAt: 0,
    }),
    listSyncStates: vi.fn().mockResolvedValue([]),
    readRecent: vi.fn().mockResolvedValue({
      complete: true,
      hasMoreBefore: true,
      messages: [],
      newestSeq: 0,
      oldestSeq: 0,
    }),
    readBefore: vi.fn(),
  }
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

function createContactsResponseWithUsers(userIds: readonly string[]) {
  return {
    data: {
      apps: [],
      groups: [],
      users: userIds.map((id) => ({
        id,
        name: id,
      })),
    },
    success: true,
  }
}

function createFriendsContactsResponse(userIds: readonly string[]) {
  return {
    data: {
      apps: [],
      directory_mode: "friends",
      groups: [],
      user_ids: userIds,
    },
    success: true,
  }
}

function createFriendRequestsResponse(requestIds: readonly string[]) {
  return {
    data: {
      requests: requestIds.map(createFriendRequestResponse),
    },
    success: true,
  }
}

function createFriendRequestResponse(id = "request-1") {
  return {
    addressee_user_id: "user-1",
    created_at: "2026-08-12T00:00:00Z",
    id,
    requester_user_id: `${id}-requester`,
    status: "pending",
    updated_at: "2026-08-12T00:00:00Z",
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

function createMessagesResponse(seq = 1, hasMoreBefore = false) {
  return {
    data: {
      messages: [
        {
          body: { content: `hello ${seq}`, type: "text" },
          client_message_id: `client-message-${seq}`,
          conversation_id: "conversation-1",
          created_at: "2026-07-21T00:00:00Z",
          id: `message-${seq}`,
          reaction_version: 1,
          reactions: [],
          sender: { id: "user-2", type: "user" },
          seq,
        },
      ],
      page: {
        has_more_after: false,
        has_more_before: hasMoreBefore,
        limit: 20,
        newest_seq: seq,
        oldest_seq: seq,
      },
    },
    success: true,
  }
}

function createNestedSenderMessagesResponse() {
  return {
    data: {
      messages: [
        {
          body: { content: "正文", type: "text" },
          client_message_id: "client-message-nested",
          conversation_id: "conversation-1",
          created_at: "2026-08-12T00:00:00Z",
          id: "message-nested",
          reaction_version: 0,
          reactions: [],
          reply_to: {
            id: "quoted-message",
            seq: 0,
            sender: { id: "quoted-sender", type: "user" },
            summary: "被引用的消息",
          },
          sender: { id: "message-sender", type: "user" },
          seq: 1,
          topic: {
            archived: false,
            conversation_id: "topic-1",
            recent_replies: [
              {
                created_at: "2026-08-12T00:00:00Z",
                id: "topic-reply-1",
                sender: { id: "topic-reply-sender", type: "user" },
                summary: "话题回复",
              },
            ],
          },
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

function createGroupConversationResponse() {
  return {
    created_at: "2026-07-09T00:00:00Z",
    id: "group-1",
    member_count: 2,
    members: [
      {
        email: "alice@example.com",
        id: "user-2",
        name: "张三",
        nickname: "小张",
        type: "user",
      },
    ],
    name: "产品讨论组",
    type: "group",
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
