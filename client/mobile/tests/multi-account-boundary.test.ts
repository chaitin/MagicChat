import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import type { AuthenticatedTarget } from "@/core/server-target"
import { createAuthenticatedScopeKey, createServerKey } from "@/data/server-key"
import {
  assertSafeAuthenticatedTarget,
  assertSecureTransport,
  isMobileCapabilityCorsOriginAllowed,
  redactSensitiveValue,
} from "@/data/auth/security-boundaries"
import { DATABASE_SCHEMA_SQL } from "@/data/database/schema"

const sameServerAlice: AuthenticatedTarget = { id: "server-a", url: "https://chat.example.test/", userId: "alice" }
const sameServerBob: AuthenticatedTarget = { id: "server-a", url: "https://chat.example.test", userId: "bob" }
const otherServerAlice: AuthenticatedTarget = { id: "server-b", url: "https://other.example.test", userId: "alice" }

test("Query 与 Manager server key 对规范化 URL 一致并隔离账号", () => {
  assert.equal(createServerKey(sameServerAlice), createServerKey({ ...sameServerAlice, url: "https://chat.example.test" }))
  assert.deepEqual(createAuthenticatedScopeKey(sameServerAlice), createAuthenticatedScopeKey({ ...sameServerAlice, url: "https://chat.example.test" }))
  assert.notDeepEqual(createAuthenticatedScopeKey(sameServerAlice), createAuthenticatedScopeKey(sameServerBob))
  assert.notDeepEqual(createAuthenticatedScopeKey(sameServerAlice), createAuthenticatedScopeKey(otherServerAlice))
})

test("全部认证业务 SQLite 表以 server_key + user_id 开始主键", () => {
  const tables = ["cached_messages", "message_sync_state", "message_cache_stats", "cached_conversations", "cached_contact_directories", "cached_user_profiles", "cached_project_pages"]
  for (const table of tables) {
    const body = DATABASE_SCHEMA_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\);`))?.[1]
    assert.ok(body, `缺少表 ${table}`)
    assert.match(body, /PRIMARY KEY\s*\(server_key,\s*user_id(?:,|\))/)
  }
})

test("缓存 SQL 读写条件不能退化为仅 server scope", async () => {
  const files = [
    "src/data/conversations/conversation-cache-store.ts",
    "src/data/contacts/contact-cache-store.ts",
    "src/data/projects/project-cache-store.ts",
    "src/data/messages/message-cache-store.ts",
    "src/data/messages/message-repository.ts",
  ]
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    // Explicit global/server maintenance deletes are allowed; account business
    // reads and updates must always carry the user discriminator.
    for (const statement of source.matchAll(/[`"]([^`"]*)[`"]/gs)) {
      if (!/\b(?:SELECT|UPDATE)\b/i.test(statement[1]) || !/\bserver_key\b/i.test(statement[1])) continue
      assert.match(statement[1], /user_id/i, `${file} 存在缺少 user_id 的 scoped SQL`)
    }
  }
})

test("账号安装/登出边界不得导入或删除 conversation/message/contact/project SQLite 缓存", async () => {
  const files = [
    "src/data/auth/account-store-core.ts",
    "src/data/auth/install-account-transaction.ts",
    "src/data/auth/sign-out-transaction.ts",
    "src/providers/auth-provider.tsx",
  ]
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /DELETE\s+FROM|DROP\s+TABLE/i, `${file} 包含业务缓存删除 SQL`)
    assert.doesNotMatch(source, /(?:conversation|message|contact|project)(?:Cache|Manager|Repository).*(?:clear|delete|remove)/i,
      `${file} 调用了业务缓存删除路径`)
  }
})

test("Native AccountStore 不得通过平台解析循环导入自身", async () => {
  const nativeSource = await readFile(
    new URL("../src/data/auth/account-store.native.ts", import.meta.url),
    "utf8"
  )
  const barrelSource = await readFile(
    new URL("../src/data/auth/account-store.ts", import.meta.url),
    "utf8"
  )
  assert.match(nativeSource, /from ["']@\/data\/auth\/account-store-core["']/)
  assert.doesNotMatch(nativeSource, /from ["']@\/data\/auth\/account-store["']/)
  assert.match(nativeSource, /export \* from ["']@\/data\/auth\/account-store-core["']/)
  assert.match(barrelSource, /export \* from ["']@\/data\/auth\/account-store-core["']/)
})

test("target、脱敏、传输与能力 CORS 安全边界", () => {
  assertSafeAuthenticatedTarget(sameServerAlice)
  assert.throws(() => assertSafeAuthenticatedTarget({ ...sameServerAlice, token: "secret" }))
  assert.deepEqual(redactSensitiveValue({ Authorization: "Bearer secret", nested: { token: "secret", ok: 1 } }), { Authorization: "[REDACTED]", nested: { token: "[REDACTED]", ok: 1 } })
  assert.doesNotThrow(() => assertSecureTransport("https://chat.example.test"))
  assert.doesNotThrow(() => assertSecureTransport("wss://chat.example.test/socket"))
  assert.doesNotThrow(() => assertSecureTransport("http://127.0.0.1:3000", true))
  assert.throws(() => assertSecureTransport("http://chat.example.test", true))
  assert.throws(() => assertSecureTransport("http://localhost:3000"))
  assert.equal(isMobileCapabilityCorsOriginAllowed(null), true)
  assert.equal(isMobileCapabilityCorsOriginAllowed("https://evil.test"), false)
  assert.equal(isMobileCapabilityCorsOriginAllowed("https://trusted.test", ["https://trusted.test"]), true)
})

test("敏感 token 不进入既有业务分发和持久化边界", async () => {
  const files = [
    "src/core/server-target.ts",
    "src/data/query/index.ts",
    "src/data/database/schema.ts",
    "src/notifications/push-registration-store.ts",
    "src/notifications/push-navigation.ts",
  ]
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8")
    assert.doesNotMatch(source, /\b(?:session_?token|access_?token|authorization)\b/i, `${file} 接纳了认证凭据`)
  }
})
