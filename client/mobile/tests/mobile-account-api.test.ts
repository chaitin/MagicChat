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
  refreshNativeSession,
  MobileSessionCompatibilityError,
} from "@/data/auth/auth-api"

const validLogin = {
  data: {
    user: { avatar: "/assets/avatars/alice.webp", email: "a@example.com", id: "user-1", name: "Alice" },
    mobile_session: { token: "secret-token", expires_at: "2999-01-01T00:00:00Z", refresh_token: "refresh-secret", refresh_expires_at: "2999-01-01T00:00:00Z", refresh_absolute_expires_at: "2999-01-01T00:00:00Z" },
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
    assert.equal(headers.get("X-Dianbao-Mobile-Session"), "2")
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
    assert.equal(init?.credentials, "omit")
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

test("401 只用同一账号的新访问凭据重试一次，不附带 Cookie", async () => {
  let requests = 0
  let refreshes = 0
  const client = createApiClient("https://example.com", async (_url, init) => {
    requests++
    assert.equal(init?.credentials, "omit")
    assert.equal(new Headers(init?.headers).get("Authorization"), requests === 1 ? "Bearer old" : "Bearer fresh")
    return requests === 1 ? json({ success: false, error: { code: "unauthorized" } }, 401) : json({ success: true, data: { ok: true } })
  }, { auth: {
    auth: async () => ({ accountId: "A", generation: 1, token: "old" }),
    refresh: async (snapshot) => { refreshes++; return { ...snapshot, token: "fresh" } },
    isCurrent: () => true,
  } })
  assert.deepEqual(await client.request("/protected", { errorMessage: "失败" }), { ok: true })
  assert.equal(requests, 2)
  assert.equal(refreshes, 1)
})

test("刷新凭据响应必须包含所有期限且不会携带 Cookie", async () => {
  const updated = await refreshNativeSession("https://example.com", "refresh-secret", async (url, init) => {
    assert.equal(url, "https://example.com/api/client/auth/native/refresh")
    assert.equal(init?.credentials, "omit")
    assert.equal(new Headers(init?.headers).get("X-Dianbao-Mobile-Session"), "2")
    assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: "refresh-secret" })
    return json({ success: true, data: validLogin.data.mobile_session })
  })
  assert.equal(updated.refreshToken, "refresh-secret")
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

test("登录凭据落盘失败时使用新刷新凭据撤销服务端 Session", async () => {
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
  assert.equal(requests[1]?.has("Authorization"), false)
  assert.equal(requests[1]?.get("X-Dianbao-Mobile-Session"), "2")
})

test("Logout 以刷新凭据撤销设备且不依赖 Cookie 或过期的访问凭据", async () => {
  await logout("https://b.example", {
    account: { accountId: "account-b", refreshToken: "refresh-b" },
    fetcher: async (url, init) => {
      assert.equal(url, "https://b.example/api/client/auth/native/revoke")
      assert.equal(new Headers(init?.headers).has("Authorization"), false)
      assert.equal(init?.credentials, "omit")
      assert.equal(JSON.parse(String(init?.body)).refresh_token, "refresh-b")
      return json({ success: false, error: { code: "unauthorized" } }, 401)
    },
  })
  await assert.rejects(logout("https://b.example", { account: { accountId: "account-b", refreshToken: "" } }), ApiRequestError)
})
