import assert from "node:assert/strict"
import test from "node:test"
import { ProjectTaskManager } from "../src/main/account/project-task-manager.ts"

const creator = { id: "u1", name: "甲", nickname: "", avatar: "" }
const task = {
  id: "task-1",
  project_id: "project-1",
  title: "发布任务",
  description: "核对结果",
  status: "todo",
  priority: 2,
  assignee: null,
  creator,
  labels: ["发版"],
  start_date: null,
  due_date: "2026-10-20",
  reminder: null,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
}
const targetId = "account"
const projectId = "project-1"

function managerFor(client: Record<string, unknown>) {
  return new ProjectTaskManager(client as never)
}

test("任务筛选及游标使用受限路径，解析 Web 对应的任务结构", async () => {
  let path = ""
  const manager = managerFor({
    get: async (url: string) => {
      path = url
      return { tasks: [task], next_cursor: "next" }
    },
  })
  const result = await manager.list({
    targetId,
    projectId,
    statuses: ["todo", "in_progress"],
    priorities: [2, 3],
    assigneeUserIds: ["u1"],
    keyword: "发布",
    cursor: "page 2",
    limit: 50,
  })
  assert.equal(path.startsWith("/api/client/projects/project-1/tasks?"), true)
  const query = new URLSearchParams(path.split("?")[1])
  assert.equal(query.get("status"), "todo,in_progress")
  assert.equal(query.get("priority"), "2,3")
  assert.equal(query.get("assignee_user_id"), "u1")
  assert.equal(query.get("keyword"), "发布")
  assert.equal(query.get("cursor"), "page 2")
  assert.equal(result.nextCursor, "next")
  assert.deepEqual(result.items[0], {
    id: task.id,
    projectId,
    title: task.title,
    description: task.description,
    status: "todo",
    priority: 2,
    assignee: null,
    creator,
    labels: ["发版"],
    startDate: null,
    dueDate: "2026-10-20",
    reminder: null,
    completedAt: null,
    canceledAt: null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  })
})

test("创建、编辑和删除使用正确方法及 snake_case 字段", async () => {
  const calls: Array<[string, string, unknown]> = []
  const manager = managerFor({
    post: async (url: string, body: unknown) => {
      calls.push(["POST", url, body])
      return task
    },
    patch: async (url: string, body: unknown) => {
      calls.push(["PATCH", url, body])
      return task
    },
    delete: async (url: string) => {
      calls.push(["DELETE", url, null])
      return { task_id: task.id }
    },
  })
  await manager.create({
    targetId,
    projectId,
    title: "发布任务",
    priority: 2,
    assigneeUserId: "u1",
  })
  await manager.update({
    targetId,
    projectId,
    taskId: task.id,
    dueDate: null,
    labels: ["已调整"],
    status: "todo",
  })
  assert.equal(await manager.delete({ targetId, projectId, taskId: task.id }), task.id)
  assert.deepEqual(calls, [
    [
      "POST",
      "/api/client/projects/project-1/tasks",
      { title: "发布任务", priority: 2, assignee_user_id: "u1" },
    ],
    [
      "PATCH",
      "/api/client/projects/project-1/tasks/task-1",
      { status: "todo", due_date: null, labels: ["已调整"] },
    ],
    ["DELETE", "/api/client/projects/project-1/tasks/task-1", null],
  ])
})

test("单独调整任务优先级只提交 priority 字段", async () => {
  let body: unknown
  const manager = managerFor({
    patch: async (_url: string, payload: unknown) => {
      body = payload
      return { ...task, priority: 3 }
    },
  })
  const updated = await manager.update({ targetId, projectId, taskId: task.id, priority: 3 })
  assert.deepEqual(body, { priority: 3 })
  assert.equal(updated.priority, 3)
})

test("成员分页、动态和评论返回可展示的数据", async () => {
  const activity = {
    id: "a1",
    project_id: projectId,
    task_id: task.id,
    actor: creator,
    type: "commented",
    content: "已检查",
    created_at: "2026-10-12T00:00:00Z",
    changes: [],
  }
  const manager = managerFor({
    get: async (url: string) =>
      url.includes("/members")
        ? {
            members: [{ id: "u1", display_name: "成员甲", role: "owner", status: "active" }],
            next_cursor: null,
          }
        : { activities: [activity], next_cursor: null },
    post: async () => activity,
  })
  assert.equal((await manager.listMembers({ targetId, projectId })).items[0]?.displayName, "成员甲")
  assert.equal(
    (await manager.listActivities({ targetId, projectId, taskId: task.id })).items[0]?.content,
    "已检查",
  )
  assert.equal(
    (await manager.addComment({ targetId, projectId, taskId: task.id, content: "已检查" })).type,
    "commented",
  )
})

test("任务创建人和动态操作者缺少姓名时通过用户解析接口补全", async () => {
  const anonymousTask = { ...task, creator: { id: "u1", name: "", nickname: "", avatar: "" } }
  const anonymousActivity = {
    id: "a1",
    project_id: projectId,
    task_id: task.id,
    actor: { id: "u2", name: "", nickname: "", avatar: "" },
    type: "commented",
    content: "已检查",
    created_at: "2026-10-12T00:00:00Z",
    changes: [],
  }
  const manager = managerFor({
    get: async (url: string) =>
      url.endsWith("/task-1")
        ? anonymousTask
        : { activities: [anonymousActivity], next_cursor: null },
    post: async (url: string, body: unknown) => {
      assert.equal(url, "/api/client/users/resolve")
      assert.deepEqual(body, {
        user_ids: [
          url.includes("resolve") && (body as { user_ids: string[] }).user_ids[0] === "u1"
            ? "u1"
            : "u2",
        ],
      })
      return {
        users: [
          {
            id: (body as { user_ids: string[] }).user_ids[0],
            name: "张三",
            nickname: "小张",
            avatar: "",
          },
        ],
      }
    },
  })
  assert.equal(
    (await manager.get({ targetId, projectId, taskId: task.id })).creator.nickname,
    "小张",
  )
  assert.equal(
    (await manager.listActivities({ targetId, projectId, taskId: task.id })).items[0]?.actor.name,
    "张三",
  )
})

test("负责人资料仅解析当前项目分页成员，保留原名昵称及联系方式", async () => {
  let reads = 0
  const manager = managerFor({
    get: async (url: string) => {
      reads += 1
      assert.match(url, /\/projects\/project-1\/members\?limit=100&cursor=next/)
      return {
        members: [
          { id: "u1", role: "owner", status: "active" },
          { id: "u2", role: "member", status: "active", email: "hidden@example.com" },
        ],
        next_cursor: "after",
      }
    },
    post: async (url: string, body: unknown) => {
      assert.equal(url, "/api/client/users/resolve")
      assert.deepEqual(body, { user_ids: ["u1", "u2"] })
      return {
        users: [
          {
            id: "u1",
            name: "张三",
            nickname: "小张",
            email: "zhang@example.com",
            phone: "+8613812345678",
          },
          { id: "outside-project", name: "其他人", email: "other@example.com" },
        ],
      }
    },
  })
  const result = await manager.listAssignees({ targetId, projectId, cursor: "next" })
  assert.equal(reads, 1)
  assert.equal(result.nextCursor, "after")
  assert.deepEqual(
    result.items.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      name: member.name,
      nickname: member.nickname,
      email: member.email,
      phone: member.phone,
    })),
    [
      {
        id: "u1",
        displayName: "小张",
        name: "张三",
        nickname: "小张",
        email: "zhang@example.com",
        phone: "+8613812345678",
      },
      { id: "u2", displayName: "未知成员", name: "", nickname: "", email: "", phone: "" },
    ],
  )
})

test("空项目分页不解析用户，异常成员资料响应报错", async () => {
  const empty = managerFor({
    get: async () => ({ members: [], next_cursor: null }),
    post: async () => {
      throw new Error("不应解析用户")
    },
  })
  assert.deepEqual(await empty.listAssignees({ targetId, projectId }), {
    items: [],
    nextCursor: null,
  })
  const invalid = managerFor({
    get: async () => ({
      members: [{ id: "u1", role: "member", status: "active" }],
      next_cursor: null,
    }),
    post: async () => ({ users: [null] }),
  })
  await assert.rejects(invalid.listAssignees({ targetId, projectId }), /项目成员资料响应格式不正确/)
})

test("不接受错误项目或非法变更、提醒和失控筛选", async () => {
  const manager = managerFor({
    get: async () => ({ tasks: [{ ...task, project_id: "other" }], next_cursor: null }),
  })
  await assert.rejects(manager.list({ targetId, projectId }), /任务响应格式不正确/)
  const writes = managerFor({
    patch: async () => {
      throw new Error("不应发送")
    },
    post: async () => {
      throw new Error("不应发送")
    },
  })
  await assert.rejects(writes.create({ targetId, projectId, title: " " }), /任务参数不正确/)
  await assert.rejects(
    writes.update({ targetId, projectId, taskId: task.id, priority: 5 as never }),
    /任务参数不正确/,
  )
  await assert.rejects(
    writes.update({
      targetId,
      projectId,
      taskId: task.id,
      reminder: {
        mode: "recurring",
        frequency: "weekly",
        time: "09:00",
        timezone: "Asia/Shanghai",
        weekdays: [],
      },
    }),
    /任务参数不正确/,
  )
  await assert.rejects(manager.list({ targetId, projectId, limit: 1000 }), /任务参数不正确/)
})
