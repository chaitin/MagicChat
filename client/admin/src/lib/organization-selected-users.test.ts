import { expect, it, vi } from "vitest"
import { retainSelectedUsers } from "./organization-selected-users"
import { listAdminUsers } from "./admin-users"

it("候选缺失时保留所有已选ID，补齐后替换占位资料", () => {
  const selected = retainSelectedUsers([], ["outside-page", "manager"])
  expect(selected.map((u) => u.id)).toEqual(["outside-page", "manager"])
  const resolved = { ...selected[0], name: "已加载成员" }
  expect(
    retainSelectedUsers([resolved], ["outside-page", "manager"])[0].name
  ).toBe("已加载成员")
  expect(retainSelectedUsers([], ["", "manager", "manager"])).toHaveLength(1)
})
it("补齐按ID查询，不依赖搜索或第一页候选", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: { users: [], total: 0 },
      }),
      { headers: { "content-type": "application/json" } }
    )
  )
  await listAdminUsers({ userIds: ["a", "b"], pageSize: 100 }, fetcher)
  expect(fetcher.mock.calls[0][0]).toBe(
    "/api/admin/users?user_ids=a%2Cb&page_size=100"
  )
})
