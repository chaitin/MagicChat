import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"
import ts from "typescript"

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (
        specifier.startsWith(".") &&
        (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
      )
        return next(`${specifier}.ts`, context)
      throw error
    }
  },
  load(url, context, next) {
    const loaded = next(url, context)
    return !url.endsWith(".ts")
      ? loaded
      : {
          ...loaded,
          format: "module",
          shortCircuit: true,
          source: ts.transpileModule(String(loaded.source), {
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
          }).outputText,
        }
  },
})
const { AccountDatabase } = await import("../src/main/account/account-database.ts")
const { ContactManager } = await import("../src/main/account/contact-manager.ts")
const id = "550e8400-e29b-41d4-a716-446655440000"
const user = {
  id,
  name: "Stranger",
  nickname: "",
  email: "",
  phone: "",
  avatar: "/avatar.webp",
  online: false,
  updated_at: "2026-10-20T00:00:00Z",
}
const snapshot = (type: "user" | "app" | "group") => ({
  users: type === "user" ? [user] : [],
  apps: type === "app" ? [{ id, name: "App", avatar: "", description: "", online: true }] : [],
  groups:
    type === "group"
      ? [{ id, name: "Group", avatar: "", joined: false, member_count: 2, visibility: "public" }]
      : [],
  conversations: [],
  removed: [],
  versions: { [`${type}:${id}`]: 1 },
})

test("查看陌生人名片只返回资料与头像，不加入好友目录", async () => {
  const db = new AccountDatabase(":memory:")
  db.replaceContacts({ mode: "friends", users: [], groups: [], apps: [] })
  const manager = new ContactManager(db, { post: async () => snapshot("user") } as never)
  try {
    const profile = await manager.resolveProfile({ type: "user", id })
    assert.equal(profile.id, id)
    assert.equal(profile.avatarType, "user")
    assert.equal("payload" in profile, false)
    assert.equal(manager.getDirectory().mode, "friends")
    assert.equal(manager.getDirectory().users.length, 0)
    assert.equal(manager.getAvatarDescriptor("user", id)?.avatarUrl, "/avatar.webp")
    // Opening the avatar preview must not indirectly add the stranger either.
    await manager.refreshAvatarDescriptor("user", id)
    assert.equal(manager.getDirectory().users.length, 0)
    assert.equal(db.getContactPayload("user", id), undefined)
  } finally {
    db.close()
  }
})

test("目录外应用与公开群资料同样只读，不改变发现列表或加入状态", async () => {
  for (const type of ["app", "group"] as const) {
    const db = new AccountDatabase(":memory:")
    db.replaceContacts({ mode: "friends", users: [], groups: [], apps: [] })
    const manager = new ContactManager(db, { post: async () => snapshot(type) } as never)
    try {
      const profile = await manager.resolveProfile({ type, id })
      assert.equal(profile.avatarType, type)
      assert.equal(manager.getDirectory().groups.length, 0)
      assert.equal(manager.getDirectory().apps.length, 0)
    } finally {
      db.close()
    }
  }
})

test("无权限或不存在的资料不返回旧缓存，也不修改好友目录", async () => {
  const db = new AccountDatabase(":memory:")
  const manager = new ContactManager(db, {
    post: async () => ({
      users: [],
      apps: [],
      groups: [],
      conversations: [],
      removed: [{ type: "user", id }],
      versions: {},
    }),
  } as never)
  try {
    await assert.rejects(manager.resolveProfile({ type: "user", id }), /资料不存在或无权查看/)
    assert.equal(manager.getDirectory().users.length, 0)
  } finally {
    db.close()
  }
})
