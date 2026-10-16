import assert from "node:assert/strict"
import test from "node:test"
import { createDesktopEntitySync } from "../src/main/account/entity-sync.ts"

test("桌面目录事件发现新联系人和应用，重连先刷新目录再对账实体", async () => {
  const calls: string[] = []
  let directory = { users: [] as { id: string }[], apps: [] as { id: string }[], groups: [] }
  let changed!: () => void
  const updated = new Promise<void>((resolve) => { changed = resolve })
  const sync = createDesktopEntitySync({
    database: { listConversations: () => [], getContactPayload: () => null },
    contacts: {
      refresh: async () => { calls.push("directory"); directory = { users: [{ id: "new-user" }], apps: [{ id: "new-app" }], groups: [] } },
      getDirectory: () => directory,
      resolveEntities: async (entities: { type: string; id: string }[]) => {
        calls.push(entities.map(({ type, id }) => `${type}:${id}`).join(","))
        return { versions: {}, users: [], apps: [], groups: [], conversations: [], removed: [] }
      },
      groupsUsingAvatar: () => [], applyEntities: () => undefined, getAvatarDescriptor: () => null,
    },
    conversations: {}, avatars: { markChanged: () => undefined },
    currentUser: { type: "user", id: "me", name: "Me" }, isCurrent: () => true,
    onError: assert.fail, onChanged: () => changed(),
  } as never)
  try {
    sync.notify("contact.directory.updated", { scope: "users", revision: 1 })
    sync.notify("contact.directory.updated", { scope: "apps", revision: 1 })
    await updated
    assert.deepEqual(calls, ["directory"])
    await sync.reconcile()
    assert.deepEqual(calls, ["directory", "directory", "user:me,user:new-user,app:new-app"])
  } finally { sync.dispose() }
})

test("桌面账号关闭后不通知旧目录或补追请求期间的新增事件", async () => {
  let finish!: () => void
  let started!: () => void
  const request = new Promise<void>((resolve) => { finish = resolve })
  const refreshing = new Promise<void>((resolve) => { started = resolve })
  let current = true
  let requests = 0
  const sync = createDesktopEntitySync({
    database: {}, conversations: {}, avatars: {}, contacts: { refresh: async () => { requests++; started(); await request } },
    currentUser: { type: "user", id: "me", name: "Me" }, isCurrent: () => current,
    onError: assert.fail, onChanged: () => assert.fail("closed account was notified"),
  } as never)
  const work = sync.reconcile()
  await refreshing
  sync.notify("contact.directory.updated", { scope: "users", revision: 1 })
  current = false
  finish()
  await work
  sync.dispose()
  assert.equal(requests, 1)
})

test("桌面实体变更更新中心资料与权限，通知群、话题和应用头像", async () => {
  const calls: unknown[] = []
  const currentUser = { type: "user", id: "me", name: "Me", avatarUrl: "old.webp" }
  let resolveApplied!: () => void
  const applied = new Promise<void>((resolve) => { resolveApplied = resolve })
  const sync = createDesktopEntitySync({
    database: {
      relatedConversationIds: (id: string) => [id, "topic-1"],
      getContactPayload: () => ({}),
    },
    contacts: {
      resolveEntities: async () => ({ versions: { "group:g1": 2, "app:a1": 1, "user:me": 1 }, users: [], apps: [], groups: [], removed: [], conversations: [{ id: "g1", members: [{ id: "me", role: "admin" }] }] }),
      groupsUsingAvatar: () => ["g1"],
      applyEntities: (_snapshot: unknown, entities: unknown) => calls.push(["contacts", entities]),
      getAvatarDescriptor: () => ({ type: "user", id: "me", name: "Me", avatarUrl: "new.webp" }),
    },
    conversations: { applyEntity: (payload: unknown, revision: number) => calls.push(["permissions", payload, revision]) },
    avatars: { markChanged: (type: string, id: string) => calls.push(["avatar", type, id]) },
    currentUser,
    isCurrent: () => true,
    onError: assert.fail,
    onChanged: (ids: unknown, avatars: unknown) => { calls.push(["changed", ids, avatars]); resolveApplied() },
  } as never)
  try {
    sync.notify("conversation.members.updated", { conversation_id: "g1", revision: 2 })
    sync.notify("app.profile.updated", { app_id: "a1", revision: 1 })
    sync.notify("user.profile.updated", { user_id: "me", revision: 1 })
    await applied
    assert.ok(calls.some((call) => JSON.stringify(call).includes('"permissions"')))
    assert.ok(calls.some((call) => JSON.stringify(call) === '["avatar","app","a1"]'))
    assert.ok(calls.some((call) => JSON.stringify(call) === '["avatar","group","g1"]'))
    const change = calls.find((call) => Array.isArray(call) && call[0] === "changed") as unknown[]
    assert.deepEqual(change[1], ["g1", "topic-1"])
    assert.equal(currentUser.avatarUrl, "new.webp")
  } finally { sync.dispose() }
})
