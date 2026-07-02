import { describe, expect, it, vi } from "vitest"

import {
  ClientDataRequestError,
  getCurrentClientUser,
  listClientContacts,
  updateCurrentClientUser,
} from "@/lib/client-data-api"

describe("client data API", () => {
  it("loads the current client user with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              avatar: "/assets/avatars/builtin/17.webp",
              created_at: "2026-07-01T12:34:56Z",
              email: "alice@example.com",
              id: "user-1",
              name: "Alice Zhang",
              nickname: "Al",
              phone: "+8613912345678",
              status: "active",
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(getCurrentClientUser(fetcher)).resolves.toEqual({
      avatar: "/assets/avatars/builtin/17.webp",
      createdAt: "2026-07-01T12:34:56Z",
      email: "alice@example.com",
      id: "user-1",
      name: "Alice Zhang",
      nickname: "Al",
      phone: "+8613912345678",
      status: "active",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/me", {
      credentials: "include",
      method: "GET",
    })
  })

  it("loads all client contacts with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            contacts: [
              {
                avatar: "/assets/avatars/builtin/03.webp",
                email: "bob@example.com",
                id: "user-2",
                name: "Bob Li",
                nickname: "",
                phone: "+8613912345679",
                type: "user",
              },
            ],
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(listClientContacts(fetcher)).resolves.toEqual([
      {
        avatar: "/assets/avatars/builtin/03.webp",
        email: "bob@example.com",
        id: "user-2",
        name: "Bob Li",
        nickname: "",
        phone: "+8613912345679",
        type: "user",
      },
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/client/contacts/users", {
      credentials: "include",
      method: "GET",
    })
  })

  it("updates the current client user profile with partial fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              avatar: "/assets/avatars/builtin/03.webp",
              created_at: "2026-07-01T12:34:56Z",
              email: "alice@example.com",
              id: "user-1",
              name: "Alice Zhang",
              nickname: "Al",
              phone: "+8613912345678",
              status: "active",
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(
      updateCurrentClientUser(
        {
          avatar: "/assets/avatars/builtin/03.webp",
        },
        fetcher
      )
    ).resolves.toMatchObject({
      avatar: "/assets/avatars/builtin/03.webp",
      nickname: "Al",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/me", {
      body: JSON.stringify({
        avatar: "/assets/avatars/builtin/03.webp",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    })
  })

  it("throws a typed unauthorized error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "unauthorized",
            message: "未登录",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 401,
        }
      )
    )

    await expect(getCurrentClientUser(fetcher)).rejects.toMatchObject({
      code: "unauthorized",
      message: "未登录",
      name: "ClientDataRequestError",
      status: 401,
    } satisfies ClientDataRequestError)
  })
})
