import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { GroupProfileSyncCache } from "../../shared/group-profile-sync-cache.ts"
import { DATABASE_SCHEMA_SQL } from "../src/data/database/schema.ts"
import type { createMobileGroupProfileCache as Create } from "../src/data/conversations/group-profile-sync-store.ts"

test("Mobile群时间跨实例持久化、按服务器账号隔离，缺失资料不能跳过", async (t) => {
  const db = new DatabaseSync(":memory:")
  db.exec(DATABASE_SCHEMA_SQL)
  t.after(() => db.close())
  const connection = {
    getAll: async (sql: string, values: unknown[]) => db.prepare(sql).all(...values as never[]),
    run: async (sql: string, values: unknown[]) => db.prepare(sql).run(...values as never[]),
  }
  const execute = (_name: string, work: (db: typeof connection) => unknown) => work(connection)
  const service = { read: execute, transaction: execute }
  const exports = {} as { createMobileGroupProfileCache: typeof Create }
  const dependencies: Record<string, unknown> = {
    "@/data/server-key": { createServerKey: (target: { url: string }) => target.url },
    "../../../../shared/group-profile-sync-cache": { GroupProfileSyncCache },
  }
  const code = ts.transpileModule(readFileSync(new URL("../src/data/conversations/group-profile-sync-store.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name] } })
  const target = { id: "server", url: "https://example.test", userId: "me" }
  const options = { isCurrent: () => true, onError: assert.fail }
  const create = (scope = target) => exports.createMobileGroupProfileCache(service as never, scope, options)
  db.prepare(`INSERT INTO cached_conversations (server_key,user_id,conversation_id,conversation_type,observed_at,cached_at,payload_json)
    VALUES (?,?,?,'group',1,1,?)`).run(target.url, target.userId, "g", JSON.stringify({ id: "g", type: "group", members: [] }))
  const cache = create()
  await cache.synced(["g"], cache.checkpoint(["g"]), () => true)
  assert.deepEqual(await create().stale(["g"]), [])
  assert.deepEqual(await create({ ...target, userId: "other" }).stale(["g"]), ["g"])
  assert.deepEqual(await create({ ...target, url: "https://other.test" }).stale(["g"]), ["g"])
  db.prepare("UPDATE cached_conversations SET tombstone_at=1").run()
  assert.deepEqual(await create().stale(["g"]), ["g"])
  cache.invalidate("g")
  await cache.stale(["g"])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM group_profile_sync_state").get()?.n, 0)
})
