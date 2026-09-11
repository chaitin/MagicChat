import assert from "node:assert/strict"
import test from "node:test"

import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { createApiClient, StaleAccountOperationError } from "@/data/api-client"

const a = { id: "same", url: "https://same.example.com", userId: "a" }
const b = { id: "same", url: "https://same.example.com", userId: "b" }

test("resolver never substitutes the active token for another explicit target", async () => {
  const reads: string[] = []
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => {
    reads.push(id)
    return { status: "valid", credential: { token: `token-${id}`, expiresAt: "2099-01-01T00:00:00Z" } }
  } })
  runtime.install({ accountId: "A", generation: 3, target: a })
  await assert.rejects(runtime.optionsFor(b, "B").auth(), /不是当前账号/)
  assert.deepEqual(reads, [])
  assert.equal((await runtime.optionsFor(a, "A").auth()).token, "token-A")
})

test("preparation is account scoped and a late generation response is discarded", async () => {
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: { token: `secret-${id}`, expiresAt: "2099-01-01T00:00:00Z" } }) })
  runtime.install({ accountId: "A", generation: 1, target: a })
  runtime.prepare({ accountId: "B", generation: 2, target: b })
  let release!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const client = createApiClient(b.url, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-B")
    await waiting
    return Response.json({ success: true, data: { ok: true } })
  }, { auth: runtime.optionsFor(b, "B") })
  const request = client.request("/api/client/me", { errorMessage: "failed" })
  runtime.cancelPreparation()
  runtime.install({ accountId: "B", generation: 3, target: b })
  release()
  await assert.rejects(request, StaleAccountOperationError)
})

test("401 is attributed to its captured account only", async () => {
  const marked: string[] = []
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: { token: `token-${id}`, expiresAt: "2099-01-01T00:00:00Z" } }) })
  runtime.install({ accountId: "A", generation: 1, target: a })
  runtime.setUnauthorizedHandler(async (id) => { marked.push(id) })
  const client = createApiClient(a.url, async () => Response.json({ success: false }, { status: 401 }), { auth: runtime.optionsFor(a, "A") })
  await assert.rejects(client.request("/api/client/me", { errorMessage: "failed" }))
  await Promise.resolve()
  assert.deepEqual(marked, ["A"])
})
