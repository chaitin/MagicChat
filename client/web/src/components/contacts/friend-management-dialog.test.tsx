import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FriendManagementDialog } from "@/components/contacts/friend-management-dialog"
import type { ContactUser, FriendRequest } from "@/lib/client-data-api"

describe("FriendManagementDialog", () => {
  it("shows search and a time-ordered combined request history", async () => {
    const user = userEvent.setup()
    const alice = createUser("user-1", "Alice")
    const carol = createUser("user-3", "Carol")
    const dave = createUser("user-4", "Dave")
    const eve = createUser("user-5", "Eve")
    const acceptRequest = vi.fn().mockResolvedValue(undefined)
    const cancelRequest = vi.fn().mockResolvedValue(undefined)
    const incoming = createRequest("request-in", carol.id, alice.id, {
      updatedAt: "2026-08-11T00:00:00Z",
    })
    const outgoing = createRequest("request-out", alice.id, dave.id, {
      updatedAt: "2026-08-12T00:00:00Z",
    })
    const accepted = createRequest("request-accepted", eve.id, alice.id, {
      handledAt: "2026-08-13T00:00:00Z",
      status: "accepted",
      updatedAt: "2026-08-13T00:00:00Z",
    })

    render(
      <FriendManagementDialog
        acceptRequest={acceptRequest}
        cancelRequest={cancelRequest}
        contacts={[]}
        createRequest={vi.fn()}
        ensureUsers={vi.fn().mockResolvedValue(undefined)}
        incomingRequests={[incoming, accepted]}
        onOpenChange={vi.fn()}
        open
        outgoingRequests={[outgoing]}
        rejectRequest={vi.fn()}
        usersById={{
          [alice.id]: alice,
          [carol.id]: carol,
          [dave.id]: dave,
          [eve.id]: eve,
        }}
      />
    )

    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "精确查找用户" })).toBeVisible()
    expect(screen.queryByRole("button", { name: /查找/ })).not.toBeInTheDocument()

    const rows = screen.getAllByText(/请求添加你为好友|你发出了好友申请/)
    expect(rows.map((row) => within(row.parentElement!).getByText(/Eve|Dave|Carol/).textContent)).toEqual([
      "Eve",
      "Dave",
      "Carol",
    ])
    expect(screen.getByText("已通过")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "接受" }))
    expect(acceptRequest).toHaveBeenCalledWith(incoming.id)

    await user.click(screen.getByRole("button", { name: "取消申请" }))
    expect(cancelRequest).toHaveBeenCalledWith(outgoing.id)
  })
})

function createUser(id: string, name: string): ContactUser {
  return {
    avatar: "",
    email: `${name.toLowerCase()}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname: "",
    online: false,
    phone: "",
    type: "user",
  }
}

function createRequest(
  id: string,
  requesterUserId: string,
  addresseeUserId: string,
  overrides: Partial<FriendRequest> = {}
): FriendRequest {
  return {
    addresseeUserId,
    createdAt: "2026-08-11T00:00:00Z",
    handledAt: null,
    id,
    requesterUserId,
    status: "pending",
    updatedAt: "2026-08-11T00:00:00Z",
    ...overrides,
  }
}
