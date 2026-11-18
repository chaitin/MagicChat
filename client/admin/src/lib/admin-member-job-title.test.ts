import { describe, expect, it, vi } from "vitest"
import { createAdminUser, updateAdminUser } from "@/lib/admin-users"

function memberResponse() {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        user: {
          id: "member",
          created_at: "2026-11-11T07:00:00Z",
          name: "张三",
          email: "member@example.test",
          job_title: "工程师",
        },
        initial_password: "temporary",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

const assignments = [
  { department_id: "department-one", is_primary: true, sort_order: 0 },
  { department_id: "department-two", is_primary: false, sort_order: 1 },
]

describe("member-level job title", () => {
  it("creates one job title with multiple organization memberships in one request", async () => {
    const fetcher = vi.fn().mockImplementation(async () => memberResponse())
    const value = await createAdminUser(
      {
        name: "张三",
        email: "member@example.test",
        jobTitle: " 工程师 ",
        assignments,
      },
      fetcher
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      name: "张三",
      email: "member@example.test",
      phone: "",
      job_title: "工程师",
      assignments,
    })
    expect(value.user.jobTitle).toBe("工程师")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("updates the member title separately from memberships and supports clearing it", async () => {
    const fetcher = vi.fn().mockImplementation(async () => memberResponse())
    const profile = {
      name: "张三",
      email: "member@example.test",
      phone: "",
      nickname: "",
    }
    await updateAdminUser(
      "member",
      { ...profile, jobTitle: " 工程师 ", assignments },
      fetcher
    )
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      ...profile,
      job_title: "工程师",
      assignments,
    })
    await updateAdminUser("member", { ...profile, jobTitle: "" }, fetcher)
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      ...profile,
      job_title: "",
    })
    await updateAdminUser("member", profile, fetcher)
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).not.toHaveProperty(
      "job_title"
    )
  })
})
