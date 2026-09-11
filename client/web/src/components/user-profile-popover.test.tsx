import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"

import { ClientProfileProvider } from "@/components/client-profile-provider"
import { UserProfilePopover } from "@/components/user-profile-popover"
import type { ClientProfileData } from "@/lib/client-profile-context"

const me = {
  avatar: "",
  createdAt: "2026-08-18T00:00:00Z",
  email: "alice@example.com",
  id: "user-1",
  lastOnlineAt: null,
  name: "Alice",
  nickname: "",
  phone: "",
  status: "active" as const,
}

const nonFriend = {
  avatar: "",
  email: "carol@example.com",
  id: "user-3",
  lastOnlineAt: null,
  name: "Carol",
  nickname: "",
  online: false,
  phone: "",
  type: "user" as const,
}

describe("UserProfilePopover friendship actions", () => {
  it("offers to add a resolved non-friend in friend mode", async () => {
    const user = userEvent.setup()
    const createFriendRequest = vi.fn(async () => undefined)

    renderProfile({ createFriendRequest })

    await user.click(screen.getByRole("button", { name: "Carol资料" }))
    await user.click(screen.getByRole("button", { name: "加好友" }))

    expect(createFriendRequest).toHaveBeenCalledWith(nonFriend.id)
  })

  it("offers messaging when the profile belongs to a friend", async () => {
    const user = userEvent.setup()

    renderProfile({ contacts: [nonFriend] })

    await user.click(screen.getByRole("button", { name: "Carol资料" }))

    expect(screen.getByRole("button", { name: "发消息" })).toBeEnabled()
  })
})

function renderProfile(overrides: Partial<ClientProfileData> = {}) {
  const profileData: ClientProfileData = {
    acceptFriendRequest: vi.fn(async () => undefined),
    contactApps: [],
    contactDirectoryMode: "friends",
    contacts: [],
    createFriendRequest: vi.fn(async () => undefined),
    incomingFriendRequests: [],
    me,
    openAppConversation: vi.fn(async () => {
      throw new Error("not implemented")
    }),
    openDirectConversation: vi.fn(async () => {
      throw new Error("not implemented")
    }),
    outgoingFriendRequests: [],
    usersById: { [nonFriend.id]: nonFriend },
    ...overrides,
  }

  return render(
    <MemoryRouter>
      <ClientProfileProvider {...profileData}>
        <UserProfilePopover triggerAriaLabel="Carol资料" userId={nonFriend.id}>
          <span>Carol</span>
        </UserProfilePopover>
      </ClientProfileProvider>
    </MemoryRouter>
  )
}
