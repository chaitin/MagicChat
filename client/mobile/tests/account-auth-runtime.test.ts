import assert from "node:assert/strict"
import test from "node:test"

import { AccountAuthRuntime } from "@/data/auth/account-auth-runtime"
import { ApiRequestError, createApiClient, StaleAccountOperationError } from "@/data/api-client"

const a = { id: "same", url: "https://same.example.com", userId: "a" }
const b = { id: "same", url: "https://same.example.com", userId: "b" }
const credential = (id: string) => ({ token: `token-${id}`, expiresAt: "2099-01-01T00:00:00Z", refreshToken: `refresh-${id}`, refreshExpiresAt: "2099-01-01T00:00:00Z", refreshAbsoluteExpiresAt: "2099-01-01T00:00:00Z" })

test("resolver never substitutes the active token for another explicit target", async () => {
  const reads: string[] = []
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => {
    reads.push(id)
    return { status: "valid", credential: credential(id) }
  } })
  runtime.install({ accountId: "A", generation: 3, target: a })
  await assert.rejects(runtime.optionsFor(b, "B").auth(), /不是当前账号/)
  assert.deepEqual(reads, [])
  assert.equal((await runtime.optionsFor(a, "A").auth()).token, "token-A")
})

test("preparation is account scoped and a late generation response is discarded", async () => {
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: { ...credential(id), token: `secret-${id}` } }) })
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

test("expired access credentials refresh once per account before requests", async () => {
  let stored = { ...credential("A"), expiresAt: "2020-01-01T00:00:00Z" }
  let refreshes = 0
  const runtime = new AccountAuthRuntime({
    getCredential: async () => ({ status: "valid", credential: stored }),
    rotateCredential: async (_id, previous, next) => {
      assert.equal(previous, "refresh-A")
      stored = next
    },
  }, async () => {
    refreshes++
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { ...credential("A"), token: "fresh-access", refreshToken: "fresh-refresh" }
  })
  runtime.install({ accountId: "A", generation: 1, target: a })
  const [first, second] = await Promise.all([runtime.optionsFor(a, "A").auth(), runtime.optionsFor(a, "A").auth()])
  assert.equal(first.token, "fresh-access")
  assert.equal(second.token, "fresh-access")
  assert.equal(refreshes, 1)
})

test("logout waits for rotation before revoking and blocks new rotations", async () => {
  let finish!: (value: ReturnType<typeof credential>) => void
  let started!: () => void
  const refreshing = new Promise<void>((resolve) => { started = resolve })
  let current = { ...credential("A"), expiresAt: "2020-01-01T00:00:00Z" }
  const runtime = new AccountAuthRuntime({
    getCredential: async () => ({ status: "valid", credential: current }),
    rotateCredential: async (_id, _previous, next) => { current = next },
  }, async () => new Promise((resolve) => { finish = resolve; started() }))
  runtime.install({ accountId: "A", generation: 1, target: a })
  const pending = runtime.optionsFor(a, "A").auth()
  await refreshing
  const ending = runtime.beginSignOut("A")
  finish({ ...credential("A"), token: "new-access", refreshToken: "new-refresh" })
  assert.equal((await pending).token, "new-access")
  const resume = await ending
  assert.equal(current.refreshToken, "new-refresh")
  await assert.rejects(runtime.optionsFor(a, "A").auth(), /正在退出登录/)
  resume()
})

test("401 is attributed to its captured account only", async () => {
  const marked: string[] = []
  const runtime = new AccountAuthRuntime({ getCredential: async (id) => ({ status: "valid", credential: credential(id) }), rotateCredential: async () => undefined }, async () => { throw new ApiRequestError("过期", { status: 401 }) })
  runtime.install({ accountId: "A", generation: 1, target: a })
  runtime.setUnauthorizedHandler(async (id) => { marked.push(id) })
  const client = createApiClient(a.url, async () => Response.json({ success: false }, { status: 401 }), { auth: runtime.optionsFor(a, "A") })
  await assert.rejects(client.request("/api/client/me", { errorMessage: "failed" }))
  await Promise.resolve()
  assert.deepEqual(marked, ["A"])
})
