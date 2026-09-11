import { act, render } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ClientUserDirectoryRealtimeSync } from "@/components/client-user-directory-realtime-sync"

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  invalidateUsers: vi.fn(),
  postMessage: vi.fn(),
  refreshMe: vi.fn().mockResolvedValue(undefined),
  updateUserPresence: vi.fn(),
}))

vi.mock("@/lib/client-data-context", () => ({
  useClientData: () => ({
    invalidateUsers: mocks.invalidateUsers,
    refreshContacts: vi.fn().mockResolvedValue(undefined),
    refreshFriendRequests: vi.fn().mockResolvedValue(undefined),
    refreshMe: mocks.refreshMe,
    updateUserPresence: mocks.updateUserPresence,
    usersById: { "user-2": { id: "user-2" } },
  }),
}))

vi.mock("@/lib/realtime-context", () => ({
  useRealtime: () => ({
    ready: false,
    subscribeRealtimeEvent: (
      event: string,
      handler: (payload: unknown) => void
    ) => {
      mocks.handlers.set(event, handler)
      return vi.fn()
    },
  }),
}))

describe("ClientUserDirectoryRealtimeSync", () => {
  afterEach(() => vi.unstubAllGlobals())

  beforeEach(() => {
    mocks.handlers.clear()
    mocks.invalidateUsers.mockReset()
    mocks.postMessage.mockReset()
    mocks.refreshMe.mockReset().mockResolvedValue(undefined)
    mocks.updateUserPresence.mockReset()
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage: ((event: MessageEvent<unknown>) => void) | null = null
        close() {}
        postMessage(value: unknown) {
          mocks.postMessage(value)
        }
      }
    )
  })

  it("invalidates profiles with the event version and broadcasts it", () => {
    render(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>
    )

    act(() => {
      mocks.handlers.get("user.profile.updated")?.({
        updated_at: "2026-07-09T01:00:01Z",
        user_id: "user-2",
      })
    })

    expect(mocks.invalidateUsers).toHaveBeenCalledWith(
      ["user-2"],
      "2026-07-09T01:00:01Z"
    )
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: "invalidate",
      updatedAt: "2026-07-09T01:00:01Z",
      userId: "user-2",
    })
  })

  it("refreshes cached profiles when the nickname policy changes", () => {
    render(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>
    )

    act(() => {
      mocks.handlers.get("user.nickname.policy.updated")?.({
        updated_at: "2026-07-09T01:00:03Z",
      })
    })

    expect(mocks.invalidateUsers).toHaveBeenCalledWith(
      ["user-2"],
      "2026-07-09T01:00:03Z"
    )
    expect(mocks.refreshMe).toHaveBeenCalled()
  })

  it("patches cached presence without resolving the full profile", () => {
    render(
      <MemoryRouter>
        <ClientUserDirectoryRealtimeSync />
      </MemoryRouter>
    )

    act(() => {
      mocks.handlers.get("user.presence.updated")?.({
        last_online_at: "2026-07-09T01:00:02Z",
        online: false,
        user_id: "user-2",
      })
    })

    expect(mocks.updateUserPresence).toHaveBeenCalledWith(
      "user-2",
      false,
      "2026-07-09T01:00:02Z"
    )
    expect(mocks.invalidateUsers).not.toHaveBeenCalled()
  })
})
