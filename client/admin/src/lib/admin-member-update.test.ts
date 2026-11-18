import { describe, expect, it, vi } from "vitest"
import { updateAdminUser } from "@/lib/admin-users"

const profile = {
  name: "成员",
  email: "member@example.test",
  nickname: "昵称",
  phone: "",
}
const assignments = [
  { department_id: "dept-1", title: "工程师", is_primary: true, sort_order: 0 },
]
const reporting = {
  direct_manager_user_id: "manager-1",
  dotted_manager_user_ids: ["manager-2"],
}

describe("unified member update", () => {
  it("submits profile, assignments and reporting with one request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              ...profile,
              id: "user-1",
              created_at: "2026-11-10T00:00:00Z",
            },
          },
        }),
        { headers: { "content-type": "application/json" } }
      )
    )
    await updateAdminUser(
      "user-1",
      { ...profile, assignments, reporting },
      fetcher
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      ...profile,
      assignments,
      reporting,
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/users/user-1",
      expect.objectContaining({
        method: "PUT",
      })
    )
  })

  it("does not send unchanged organization sections for a profile-only edit", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              ...profile,
              id: "user-1",
              created_at: "2026-11-10T00:00:00Z",
            },
          },
        }),
        { headers: { "content-type": "application/json" } }
      )
    )
    await updateAdminUser("user-1", profile, fetcher)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).not.toHaveProperty("assignments")
    expect(body).not.toHaveProperty("reporting")
  })
})
