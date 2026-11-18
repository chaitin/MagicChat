import { describe, expect, it, vi } from "vitest"
import { createAdminUser } from "@/lib/admin-users"

describe("create member with organization", () => {
  it("submits the selected department in the same create request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              id: "member-1",
              created_at: "2026-11-11T03:00:00Z",
              name: "成员",
              email: "member@example.test",
            },
            initial_password: "temporary-password",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    )
    const result = await createAdminUser(
      {
        name: " 成员 ",
        email: " member@example.test ",
        departmentId: "selected-department",
      },
      fetcher
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe("/api/admin/users")
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      name: "成员",
      email: "member@example.test",
      phone: "",
      department_id: "selected-department",
    })
    expect(result.initialPassword).toBe("temporary-password")
  })
})
