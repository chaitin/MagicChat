import assert from "node:assert/strict"
import test from "node:test"

import {
  AccountUnauthorizedError,
  ApiRequestError,
  createApiClient,
  StaleAccountOperationError,
  type ApiFetch,
} from "@/data/api-client"
import {
  login,
  loginWithEmailCode,
  logout,
  MobileSessionCompatibilityError,
} from "@/data/auth/auth-api"

const validLogin = {
  data: {
    user: { avatar: "/assets/avatars/alice.webp", email: "a@example.com", id: "user-1", name: "Alice" },
    mobile_session: { token: "secret-token", expires_at: "2999-01-01T00:00:00Z" },
  },
  success: true,
}
const json = (body: unknown, status = 200) => Response.json(body, { status })

test("密码和邮箱验证码登录协商 Mobile Session，且匿名请求不携带 Authorization", async () => {
  const seen: Headers[] = []
  const fetcher: ApiFetch = async (_url, init) => {
    seen.push(new Headers(init?.headers))
    return json(validLogin)
  }
  let consumed = ""
  const user = await login("https://example.com", { account: "a", password: "p" }, { fetcher, onMobileSession: (value) => { consumed = value.token } })
  await loginWithEmailCode("https://example.com", { email: "a", code: "1" }, { fetcher })
  assert.equal(consumed, "secret-token")
  assert.equal(user.avatar, "/assets/avatars/alice.webp")
  for (const headers of seen) {
    assert.equal(headers.get("X-Dianbao-Mobile-Session"), "1")
    assert.equal(headers.has("Authorization"), false)
  }
})

test("登录严格拒绝缺失、损坏和过期 mobile_session", async () => {
  const cases = [
    { ...validLogin, data: { ...validLogin.data, mobile_session: undefined } },
    { ...validLogin, data: { ...validLogin.data, mobile_session: { token: "x", expires_at: "bad" } } },
    { ...validLogin, data: { ...validLogin.data, mobile_session: { token: "x", expires_at: "2000-01-01T00:00:00Z" } } },
  ]
  for (const body of cases) {
    await assert.rejects(login("https://example.com", { account: "a", password: "p" }, { fetcher: async () => json(body) }), MobileSessionCompatibilityError)
  }
})

test("public client 不注入 Bearer，protected client 每请求只解析一次并大小写安全地禁止覆盖", async () => {
  let resolves = 0
  let protectedHeaders = new Headers()
  const auth = {
    auth: async () => { resolves++; return { accountId: "account-a", generation: 7, token: "token-a" } },
    isCurrent: () => true,
  }
  await createApiClient("https://example.com", async (_url, init) => {
    protectedHeaders = new Headers(init?.headers)
    assert.equal(init?.credentials, "include")
    return json({ data: { ok: true }, success: true })
  }, { auth }).request("/protected", { errorMessage: "失败" })
  assert.equal(resolves, 1)
  assert.equal(protectedHeaders.get("Authorization"), "Bearer token-a")

  await assert.rejects(
    createApiClient("https://example.com", async () => json({}), { auth }).request("/protected", { errorMessage: "失败", headers: { authorization: "Bearer caller" } }),
    /不能覆盖/
  )
  assert.equal(resolves, 1)
  await createApiClient("https://example.com", async (_url, init) => {
    assert.equal(new Headers(init?.headers).has("Authorization"), false)
    return json({ data: {}, success: true })
  }).request("/public", { errorMessage: "失败" })

  let protectedFetchCalled = false
  await assert.rejects(
    createApiClient("https://example.com", async () => {
      protectedFetchCalled = true
      return json({ data: {}, success: true })
    }).request("/api/client/conversations", { errorMessage: "失败" }),
    /必须使用显式账号认证目标/
  )
  assert.equal(protectedFetchCalled, false)
})

test("请求使用同一 target/token snapshot 并丢弃 stale response", async () => {
  let current = true
  let requestedUrl = ""
  const client = createApiClient("https://account-a.example", async (url, init) => {
    requestedUrl = url
    current = false
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer token-a")
    return json({ data: { secret: true }, success: true })
  }, { auth: { auth: async () => ({ accountId: "account-a", generation: 1, token: "token-a" }), isCurrent: () => current } })
  await assert.rejects(client.request("/resource", { errorMessage: "失败" }), StaleAccountOperationError)
  assert.equal(requestedUrl, "https://account-a.example/resource")
  assert.equal(requestedUrl.includes("token-a"), false)
})

test("401 归属账号、触发 callback 且错误脱敏", async () => {
  let callbackAccount = ""
  const client = createApiClient("https://example.com", async () => json({ success: false, error: { message: "Authorization: Bearer token-a" } }, 401), {
    auth: {
      auth: async () => ({ accountId: "account-a", generation: 1, token: "token-a" }),
      isCurrent: () => true,
      onUnauthorized: (accountId) => { callbackAccount = accountId },
    },
  })
  await assert.rejects(client.request("/protected", { errorMessage: "失败" }), (error: unknown) => {
    assert.ok(error instanceof AccountUnauthorizedError)
    assert.equal(error.accountId, "account-a")
    assert.equal(error.message.includes("token-a"), false)
    return true
  })
  assert.equal(callbackAccount, "account-a")
})

test("401 业务码默认仍使 Session 失效，只有调用点显式声明才豁免", async () => {
  let unauthorizedCalls = 0
  let leakedOption = false
  const auth = {
    auth: async () => ({ accountId: "account-a", generation: 1, token: "token-a" }),
    isCurrent: () => true,
    onUnauthorized: () => { unauthorizedCalls++ },
  }
  const fetcher: ApiFetch = async (_url, init) => {
    leakedOption = "nonSessionUnauthorizedCodes" in (init ?? {})
    return json({ success: false, error: { code: "invalid_code", message: "验证码错误" } }, 401)
  }
  const client = createApiClient("https://example.com", fetcher, { auth })
  await assert.rejects(client.request("/protected", { errorMessage: "失败" }), AccountUnauthorizedError)
  assert.equal(unauthorizedCalls, 1)
  await assert.rejects(
    client.request("/protected", { errorMessage: "失败", nonSessionUnauthorizedCodes: ["invalid_code"] }),
    (error: unknown) => error instanceof ApiRequestError && !(error instanceof AccountUnauthorizedError) && error.code === "invalid_code"
  )
  assert.equal(unauthorizedCalls, 1)
  assert.equal(leakedOption, false)
})

test("认证 resolver 受请求超时和父级取消控制", async () => {
  const never = new Promise<never>(() => undefined)
  const client = createApiClient("https://example.com", async () => json({}), {
    auth: {
      auth: () => never,
      isCurrent: () => true,
    },
  })
  await assert.rejects(
    client.request("/protected", { errorMessage: "失败", timeoutMs: 5 }),
    /请求超时/
  )

  const controller = new AbortController()
  const cancelled = client.request("/protected", {
    errorMessage: "失败",
    signal: controller.signal,
    timeoutMs: 1_000,
  })
  controller.abort()
  await assert.rejects(cancelled, (error: unknown) => {
    assert.equal((error as Error).name, "AbortError")
    return true
  })
})

test("登录凭据落盘失败时使用新 Bearer 撤销服务端 Session", async () => {
  const requests: Headers[] = []
  const fetcher: ApiFetch = async (_url, init) => {
    requests.push(new Headers(init?.headers))
    return requests.length === 1
      ? json(validLogin)
      : json({ data: {}, success: true })
  }
  await assert.rejects(
    login(
      "https://example.com",
      { account: "a", password: "p" },
      {
        fetcher,
        onMobileSession: () => {
          throw new Error("secure write failed")
        },
      }
    ),
    /secure write failed/
  )
  assert.equal(requests.length, 2)
  assert.equal(requests[1]?.get("Authorization"), "Bearer secret-token")
})

test("Logout 使用指定账号 resolver，账号不匹配被拒绝，401 无失效副作用地视为成功", async () => {
  let authorization = ""
  let installationHeader = ""
  let unauthorizedCalls = 0
  const auth = {
    auth: async () => ({ accountId: "account-b", generation: 2, token: "token-b" }),
    isCurrent: () => true,
    onUnauthorized: () => {
      unauthorizedCalls++
    },
  }
  await logout("https://b.example", {
    account: { accountId: "account-b", auth },
    pushInstallationId: "installation-b",
    fetcher: async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? ""
      installationHeader = new Headers(init?.headers).get("X-Push-Installation-ID") ?? ""
      return json({ success: false, error: { code: "unauthorized" } }, 401)
    },
  })
  assert.equal(authorization, "Bearer token-b")
  assert.equal(installationHeader, "installation-b")
  assert.equal(unauthorizedCalls, 0)
  await assert.rejects(
    logout("https://b.example", {
      account: { accountId: "account-a", auth },
      fetcher: async () => json({ success: true }),
    }),
    ApiRequestError
  )
})
