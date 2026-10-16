import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import type * as Store from "../src/data/contacts/contact-cache-store.ts"

function fixture() {
  const database = new DatabaseSync(":memory:")
  database.exec(`CREATE TABLE cached_user_profiles (
    server_key TEXT, user_id TEXT, profile_user_id TEXT, payload_json TEXT,
    version TEXT, cached_at INTEGER, missing_until INTEGER,
    PRIMARY KEY(server_key,user_id,profile_user_id));`)
  const connection = {
    run: async (sql: string, values: unknown[]) => database.prepare(sql).run(...values as never[]),
    getAll: async (sql: string, values: unknown[]) => database.prepare(sql).all(...values as never[]),
  }
  const execute = (_name: string, run: (db: typeof connection) => unknown) => run(connection)
  const dependencies: Record<string, unknown> = {
    "@/data/database/database-service": { databaseService: { read: execute, write: execute, transaction: execute } },
    "@/data/server-key": { createServerKey: (target: { url: string }) => target.url },
  }
  const exports = {} as typeof Store
  const code = ts.transpileModule(readFileSync(new URL("../src/data/contacts/contact-cache-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: (name: string) => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  } })
  return { store: exports, close: () => database.close() }
}

test("用户头像实体版本写入SQLite，旧批量资料及缺失结果不能覆盖新资料", async (t) => {
  const { store, close } = fixture()
  t.after(close)
  const target = { id: "server", url: "https://entity.test", userId: "me" }
  const user = { id: "user-1", type: "user" as const, avatar: "new.webp", name: "User", nickname: "", email: "", phone: "", online: false, lastOnlineAt: null, updatedAt: "2026-01-02T00:00:00Z", entityRevision: 3 }
  await store.mergeUserProfiles(target, [user], [], 0)
  await store.mergeUserProfiles(target, [{ ...user, avatar: "old.webp", entityRevision: 2 }], [], 0)
  assert.equal((await store.readUserProfiles(target)).get(user.id)?.profile?.avatar, "new.webp")
  await store.mergeUserProfiles(target, [], [user.id], Date.now() + 10_000)
  assert.equal((await store.readUserProfiles(target)).get(user.id)?.profile?.avatar, "new.webp")
  await store.mergeUserProfiles(target, [], [user.id], Date.now() + 10_000, true)
  assert.equal((await store.readUserProfiles(target)).get(user.id)?.profile, null)
  assert.equal((await store.readUserProfiles({ ...target, userId: "other" })).size, 0)
})
