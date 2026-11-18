import { describe, expect, it, vi } from "vitest"
import { listAdminUsers, updateAdminUser } from "@/lib/admin-users"

const user = {
  id: "user-1",
  created_at: "2026-11-10T00:00:00Z",
  name: "张三",
  email: "zhang@example.com",
  phone: "+8613812345678",
  nickname: "小张",
  status: "active",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("admin member profile editing", () => {
  it("updates only editable profile fields and returns normalized data", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ success: true, data: { user } }))
    const result = await updateAdminUser(
      "user/1",
      {
        name: " 张三 ",
        email: " zhang@example.com ",
        phone: " 13812345678 ",
        nickname: " 小张 ",
      },
      fetcher
    )
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/users/user%2F1",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({
          name: "张三",
          email: "zhang@example.com",
          phone: "13812345678",
          nickname: "小张",
        }),
      })
    )
    expect(result.name).toBe("张三")
    expect(result.phone).toBe("+8613812345678")
  })

  it("surfaces duplicate email errors without returning a successful edit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response(
          {
            success: false,
            error: { code: "conflict", message: "邮箱已存在" },
          },
          409
        )
      )
    await expect(
      updateAdminUser(
        "user-1",
        { name: "张三", email: "used@example.com", phone: "", nickname: "" },
        fetcher
      )
    ).rejects.toMatchObject({ message: "邮箱已存在", code: "conflict" })
  })

  it("rejects an invalid update response", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(response({ success: true, data: {} }))
    await expect(
      updateAdminUser(
        "user-1",
        { name: "张三", email: "zhang@example.com", phone: "", nickname: "" },
        fetcher
      )
    ).rejects.toThrow("成员资料响应格式不正确")
  })

  it("requests and normalizes primary organization fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        response({
          success: true,
          data: {
            users: [
              {
                ...user,
                organization: {
                  unit_name: "长亭科技",
                  department_name: "研发部",
                  title: "工程师",
                },
              },
            ],
            total: 1,
          },
        })
      )
    const result = await listAdminUsers({ includeOrganization: true }, fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/users?include_organization=true",
      expect.anything()
    )
    expect(result.users[0].organization).toEqual({
      unitName: "长亭科技",
      departmentName: "研发部",
      title: "工程师",
    })
  })
})
