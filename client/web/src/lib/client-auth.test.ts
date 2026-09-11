import { describe, expect, it, vi } from "vitest"

import {
  ClientLoginRequestError,
  clientEmailCodeLogin,
  clientLogin,
  requestClientEmailCode,
} from "@/lib/client-auth"

describe("client auth", () => {
  it("logs in through the client auth API", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              created_at: "2026-07-01T00:00:00Z",
              email: "alice@example.com",
              id: "user-1",
              name: "Alice",
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

    const user = await clientLogin(
      {
        account: " Alice@Example.com ",
        password: "secret",
      },
      fetcher
    )

    expect(user).toEqual({
      email: "alice@example.com",
      id: "user-1",
      name: "Alice",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/auth/login", {
      body: JSON.stringify({
        email: "Alice@Example.com",
        password: "secret",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
  })

  it("throws the client API error message when login fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "invalid_credentials",
            message: "邮箱或密码错误",
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

    await expect(
      clientLogin(
        {
          account: "alice@example.com",
          password: "wrong",
        },
        fetcher
      )
    ).rejects.toMatchObject({
      code: "invalid_credentials",
      message: "邮箱或密码错误",
      name: "ClientLoginRequestError",
    } satisfies ClientLoginRequestError)
  })

  it("requests an email code and logs in with eight digits", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              expires_in_seconds: 900,
              retry_after_seconds: 5,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              user: {
                email: "alice@example.com",
                id: "user-1",
                name: "Alice",
              },
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          }
        )
      )

    await expect(
      requestClientEmailCode(" Alice@Example.com ", fetcher)
    ).resolves.toEqual({
      expiresInSeconds: 900,
      retryAfterSeconds: 5,
    })
    await expect(
      clientEmailCodeLogin(
        { code: "01234567", email: " Alice@Example.com " },
        fetcher
      )
    ).resolves.toEqual({
      email: "alice@example.com",
      id: "user-1",
      name: "Alice",
    })

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/client/auth/email-code/request",
      {
        body: JSON.stringify({ email: "Alice@Example.com" }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    )
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/client/auth/email-code/login",
      {
        body: JSON.stringify({
          code: "01234567",
          email: "Alice@Example.com",
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }
    )
  })
})
