import assert from "node:assert/strict"
import test from "node:test"
import { ProjectManager } from "../src/main/account/project-manager.ts"

const personal = { id: "personal", name: "我的项目", description: "个人空间", is_personal: true }
const collaboration = { id: "team", name: "团队项目", description: "协作空间", is_personal: false }
const next = { id: "second", name: "第二个项目", description: "", is_personal: false }

function managerFor(get: (url: string) => Promise<unknown>) {
  return new ProjectManager({ get } as never, {} as never, {} as never)
}

test("项目列表包含个人项目和全部分页协作项目，绑定列表保持排除个人项目", async () => {
  const requests: string[] = []
  const manager = managerFor(async (url) => {
    requests.push(url)
    return url.includes("cursor=next")
      ? { projects: [next], next_cursor: null }
      : { personal_project: personal, projects: [collaboration], next_cursor: "next" }
  })
  assert.deepEqual(await manager.listProjects(), {
    personalProject: { id: "personal", name: "我的项目", description: "个人空间" },
    projects: [
      { id: "team", name: "团队项目", description: "协作空间" },
      { id: "second", name: "第二个项目", description: "" },
    ],
  })
  assert.deepEqual(await manager.listBindableProjects(), [
    { id: "team", name: "团队项目", description: "协作空间" },
    { id: "second", name: "第二个项目", description: "" },
  ])
  assert.deepEqual(requests, [
    "/api/client/projects?limit=100",
    "/api/client/projects?limit=100&cursor=next",
    "/api/client/projects?limit=100",
    "/api/client/projects?limit=100&cursor=next",
  ])
})

test("无个人项目时正确显示空项目列表", async () => {
  const manager = managerFor(async () => ({
    personal_project: { id: "", name: "", is_personal: false },
    projects: [],
    next_cursor: null,
  }))
  assert.deepEqual(await manager.listProjects(), { personalProject: null, projects: [] })
})

test("创建项目提交去空白的名称和可选关联群聊，并返回项目摘要", async () => {
  for (const groupIds of [
    [],
    ["group-1"],
    Array.from({ length: 100 }, (_, index) => `group-${index}`),
  ]) {
    const requests: unknown[] = []
    const manager = new ProjectManager(
      {
        post: async (url: string, body: unknown) => {
          requests.push({ url, body })
          return collaboration
        },
      } as never,
      {} as never,
      {} as never,
    )
    assert.deepEqual(await manager.create({ name: "  团队项目  ", groupIds }), {
      id: "team",
      name: "团队项目",
      description: "协作空间",
    })
    assert.deepEqual(requests, [
      { url: "/api/client/projects", body: { name: "团队项目", group_ids: groupIds } },
    ])
  }
})

test("创建项目拒绝空名称、过长名称和无效或超量群聊，不发送请求", async () => {
  let requests = 0
  const manager = new ProjectManager(
    {
      post: async () => {
        requests++
        return collaboration
      },
    } as never,
    {} as never,
    {} as never,
  )
  for (const name of ["", "  ", "字".repeat(121)]) {
    await assert.rejects(manager.create({ name, groupIds: [] }), /项目名称长度/)
  }
  for (const groupIds of [
    null,
    [""],
    [null],
    ["g".repeat(129)],
    Array.from({ length: 101 }, (_, index) => `group-${index}`),
  ]) {
    await assert.rejects(
      manager.create({ name: "项目", groupIds } as never),
      /最多关联 100 个有效群聊/,
    )
  }
  assert.equal(requests, 0)
})

test("创建项目保留服务端错误并拒绝无效响应", async () => {
  const failure = new Error("你不是该群聊成员")
  const failed = new ProjectManager(
    {
      post: async () => {
        throw failure
      },
    } as never,
    {} as never,
    {} as never,
  )
  await assert.rejects(
    failed.create({ name: "项目", groupIds: ["group"] }),
    (error) => error === failure,
  )
  const invalid = new ProjectManager(
    { post: async () => ({ id: "", name: "项目" }) } as never,
    {} as never,
    {} as never,
  )
  await assert.rejects(invalid.create({ name: "项目", groupIds: [] }), /响应格式不正确/)
})

test("拒绝损坏的个人项目和循环分页", async () => {
  await assert.rejects(
    managerFor(async () => ({
      personal_project: { ...personal, is_personal: false },
      projects: [],
      next_cursor: null,
    })).listProjects(),
    /个人项目响应格式不正确/,
  )
  await assert.rejects(
    managerFor(async () => ({ projects: [collaboration], next_cursor: "again" })).listProjects(),
    /项目列表分页格式不正确/,
  )
})
