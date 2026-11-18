import assert from "node:assert/strict"
import test from "node:test"
import {
  buildOrganizationDirectoryTree,
  matchesOrganizationMember,
  OrganizationMemberPager,
} from "../../shared/organization-directory.ts"

const snapshot = {
  units: [
    { id: "group", parent_id: null, name: "集团", kind: "group" },
    { id: "subsidiary", parent_id: "group", name: "子公司", kind: "subsidiary" },
  ],
  departments: [
    { id: "root", unit_id: "group", parent_id: null, name: "集团", is_root: true },
    { id: "engineering", unit_id: "group", parent_id: "root", name: "技术中心", is_root: false },
    { id: "dev", unit_id: "group", parent_id: "engineering", name: "研发部", is_root: false },
    { id: "sub-root", unit_id: "subsidiary", parent_id: null, name: "子公司", is_root: true },
  ],
}
test("单位根节点与部门嵌套，不重复显示根部门", () => {
  const [root] = buildOrganizationDirectoryTree(snapshot)
  assert.equal(root.departmentId, "root")
  assert.equal(root.defaultOpen, true)
  assert.deepEqual(
    root.children.map((node) => node.name),
    ["技术中心", "子公司"],
  )
  assert.equal(root.children[0].children[0].departmentId, "dev")
  assert.equal(root.children[1].defaultOpen, false)
})
test("搜索保留匹配部门的祖先，匹配单位时保留其部门", () => {
  const [root] = buildOrganizationDirectoryTree(snapshot, "研发")
  assert.equal(root.children.length, 1)
  assert.equal(root.children[0].children[0].name, "研发部")
  assert.equal(buildOrganizationDirectoryTree(snapshot, "集团")[0].children.length, 2)
  assert.deepEqual(buildOrganizationDirectoryTree(snapshot, "不存在"), [])
  assert.equal(
    matchesOrganizationMember(
      { name: "张三", nickname: "小张", phone: "+86 13800138000" },
      "13800138000",
    ),
    true,
  )
  assert.equal(
    matchesOrganizationMember({ name: "张三", email: "a@example.test" }, "EXAMPLE"),
    true,
  )
})
test("相邻页请求合并，失败重试当前页并保留已有成员", async () => {
  const calls: number[] = []
  let finish!: (value: { members: { id: string }[]; total: number }) => void
  let fail = true
  const pager = new OrganizationMemberPager<{ id: string }>((page) => {
    calls.push(page)
    if (page === 1)
      return new Promise((resolve) => {
        finish = resolve
      })
    if (fail) return Promise.reject(new Error("网络中断"))
    return Promise.resolve({ members: [{ id: "a" }, { id: "b" }], total: 2 })
  })
  const first = pager.loadNext()
  assert.equal(first, pager.loadNext())
  await Promise.resolve()
  finish({ members: [{ id: "a" }], total: 2 })
  await first
  await pager.loadNext()
  assert.equal(pager.getSnapshot().page, 1)
  assert.equal(pager.getSnapshot().error, "网络中断")
  assert.deepEqual(pager.getSnapshot().members, [{ id: "a" }])
  fail = false
  await pager.loadNext()
  assert.deepEqual(calls, [1, 2, 2])
  assert.deepEqual(pager.getSnapshot().members, [{ id: "a" }, { id: "b" }])
  await pager.loadNext()
  assert.deepEqual(calls, [1, 2, 2])
})
test("不同节点的成员缓存和分页互不覆盖", async () => {
  const first = new OrganizationMemberPager(async () => ({ members: [{ id: "first" }], total: 1 }))
  const second = new OrganizationMemberPager(async () => ({
    members: [{ id: "second" }],
    total: 1,
  }))
  await Promise.all([first.loadNext(), second.loadNext()])
  assert.equal(first.getSnapshot().members[0].id, "first")
  assert.equal(second.getSnapshot().members[0].id, "second")
})
