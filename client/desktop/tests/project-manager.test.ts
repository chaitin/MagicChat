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
