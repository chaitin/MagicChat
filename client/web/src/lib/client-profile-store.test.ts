import { describe, expect, it, vi } from "vitest"

import { ClientProfileStore } from "@/lib/client-profile-store"

describe("ClientProfileStore", () => {
  it("reuses equal profile objects without notifying subscribers", () => {
    const snapshot = createSnapshot()
    const store = new ClientProfileStore(snapshot)
    const originalUser = store.getUser("user-2")
    const originalApp = store.getApp("app-1")
    const userListener = vi.fn()
    const appListener = vi.fn()
    store.subscribeUser("user-2", userListener)
    store.subscribeApp("app-1", appListener)

    store.replace({
      contactApps: snapshot.contactApps.map((app) => ({ ...app })),
      contactDirectoryMode: snapshot.contactDirectoryMode,
      contacts: snapshot.contacts.map((contact) => ({ ...contact })),
      incomingFriendRequests: snapshot.incomingFriendRequests,
      me: { ...snapshot.me },
      outgoingFriendRequests: snapshot.outgoingFriendRequests,
      usersById: snapshot.usersById,
    })

    expect(store.getUser("user-2")).toBe(originalUser)
    expect(store.getApp("app-1")).toBe(originalApp)
    expect(userListener).not.toHaveBeenCalled()
    expect(appListener).not.toHaveBeenCalled()
  })

  it("notifies changed and removed profile IDs independently", () => {
    const snapshot = createSnapshot()
    const store = new ClientProfileStore(snapshot)
    const userListener = vi.fn()
    const appListener = vi.fn()
    store.subscribeUser("USER-2", userListener)
    store.subscribeApp("APP-1", appListener)

    store.replace({
      contactApps: [],
      contactDirectoryMode: snapshot.contactDirectoryMode,
      contacts: [{ ...snapshot.contacts[0], online: true }],
      incomingFriendRequests: [],
      me: snapshot.me,
      outgoingFriendRequests: [],
      usersById: {},
    })

    expect(userListener).toHaveBeenCalledOnce()
    expect(appListener).toHaveBeenCalledOnce()
    expect(store.getApp("app-1")).toBeUndefined()
  })

  it("indexes resolved users outside the contact list", () => {
    const snapshot = createSnapshot()
    const nonFriend = createContact("user-3", "Carol")
    const store = new ClientProfileStore({
      ...snapshot,
      usersById: { [nonFriend.id]: nonFriend },
    })

    expect(store.getUser(nonFriend.id)).toBe(nonFriend)
  })
})

function createSnapshot() {
  return {
    contactApps: [
      {
        avatar: "",
        creatorUserId: null,
        description: "AI 助手",
        id: "app-1",
        name: "茉莉",
        online: true,
        type: "app" as const,
      },
    ],
    contactDirectoryMode: "organization" as const,
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
        type: "user" as const,
      },
    ],
    incomingFriendRequests: [],
    me: {
      avatar: "",
      createdAt: "2026-07-22T00:00:00Z",
      email: "alice@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "Alice",
      nickname: "",
      phone: "",
      status: "active" as const,
    },
    outgoingFriendRequests: [],
    usersById: {},
  }
}

function createContact(id: string, name: string) {
  return {
    avatar: "",
    email: `${name.toLowerCase()}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname: "",
    online: false,
    phone: "",
    type: "user" as const,
  }
}
