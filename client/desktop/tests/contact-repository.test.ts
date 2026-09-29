import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { initializeAccountSchema } from "../src/main/account/database/account-schema.ts"
import { ContactRepository } from "../src/main/account/database/contact-repository.ts"

function repository() {
  const database = new DatabaseSync(":memory:")
  initializeAccountSchema(database)
  const contacts = new ContactRepository(database)
  contacts.replace({
    mode: "organization",
    users: [
      {
        id: "00000000-0000-0000-0000-000000000011",
        name: "张三",
        nickname: "小张",
        email: "",
        phone: "",
        online: false,
        lastOnlineAt: null,
        avatarType: "user",
        avatarId: "00000000-0000-0000-0000-000000000011",
        avatar: "",
        updatedAt: "2026-01-01T00:00:00Z",
        payload: {},
      },
      {
        id: "00000000-0000-0000-0000-000000000012",
        name: "李四",
        nickname: "",
        email: "",
        phone: "",
        online: false,
        lastOnlineAt: null,
        avatarType: "user",
        avatarId: "00000000-0000-0000-0000-000000000012",
        avatar: "",
        updatedAt: "2026-01-01T00:00:00Z",
        payload: {},
      },
    ],
    groups: [],
    apps: [
      {
        id: "00000000-0000-0000-0000-000000000021",
        name: "日报助手",
        description: "",
        online: false,
        creatorUserId: null,
        avatarType: "app",
        avatarId: "00000000-0000-0000-0000-000000000021",
        avatar: "",
        payload: {},
      },
    ],
  })
  return { database, contacts }
}

test("按通讯录现查发送者名字", () => {
  const { database, contacts } = repository()
  assert.equal(contacts.resolveDisplayName("user", "00000000-0000-0000-0000-000000000011"), "小张")
  assert.equal(contacts.resolveDisplayName("user", "00000000-0000-0000-0000-000000000012"), "李四")
  assert.equal(
    contacts.resolveDisplayName("app", "00000000-0000-0000-0000-000000000021"),
    "日报助手",
  )
  // 大小写不一致也要能查到，通讯录里查不到返回 undefined。
  assert.equal(
    contacts.resolveDisplayName("user", "00000000-0000-0000-0000-000000000011".toUpperCase()),
    "小张",
  )
  assert.equal(
    contacts.resolveDisplayName("user", "00000000-0000-0000-0000-000000000099"),
    undefined,
  )
  assert.equal(contacts.resolveDisplayName("user", ""), undefined)
  assert.equal(contacts.resolveDisplayName("system", ""), undefined)
  database.close()
})
