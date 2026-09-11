import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { normalizeDeactivationCode } from "@/features/me/account-deactivation-model"
import { isSafeAccountDeactivationRejection } from "@/data/auth/account-deactivation-failure"
import { AccountUnauthorizedError, ApiRequestError } from "@/data/api-client"
import { parseAccountDeactivationCodeResult } from "@/data/auth/account-deactivation-api"

const root = new URL("../", import.meta.url)

async function source(path: string) {
  return readFile(new URL(path, root), "utf8")
}

test("注销验证码只保留 8 位数字", () => {
  assert.equal(normalizeDeactivationCode("12a34-567890"), "12345678")
})

test("仅服务端明确拒绝可恢复，响应丢失和账号失效都进入不确定失败", () => {
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("bad", { code: "invalid_code", status: 401 })), true)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("bad", { code: "invalid_request", status: 400 })), true)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("wrong status", { code: "invalid_code", status: 500 })), false)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("wrong status", { code: "invalid_request", status: 401 })), false)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("timeout", { kind: "connection" })), false)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("response lost", { status: 500 })), false)
  assert.equal(isSafeAccountDeactivationRejection(new ApiRequestError("inactive", { code: "account_not_active", status: 409 })), false)
  assert.equal(isSafeAccountDeactivationRejection(new AccountUnauthorizedError("account-a")), false)
  assert.equal(isSafeAccountDeactivationRejection(new Error("unknown")), false)
})

test("发码响应要求正数有效期，但重试倒计时允许为零", () => {
  assert.deepEqual(parseAccountDeactivationCodeResult({ expires_in_seconds: 1, retry_after_seconds: 0 }), { expiresInSeconds: 1, retryAfterSeconds: 0 })
  assert.throws(() => parseAccountDeactivationCodeResult({ expires_in_seconds: 0, retry_after_seconds: 0 }), /响应格式/)
  assert.throws(() => parseAccountDeactivationCodeResult({ expires_in_seconds: 1, retry_after_seconds: -1 }), /响应格式/)
})

test("个人信息注销入口独立居中红色且 ActionSheet 延迟导航", async () => {
  const profile = await source("src/features/me/profile-screen.tsx")
  assert.match(profile, /<XGUIList size="large">\s*<XGUIListItem centerContent destructive/)
  assert.match(profile, /setDeactivationSheetOpen\(true\).*title="注销账号"/)
  assert.match(profile, /deferUntilClosed: true, destructive: true, label: "继续注销"/)
  assert.match(profile, /注销后账号将无法登录，无法自行恢复；如需恢复请联系管理员。/)
})

test("注销页面与 API 保持验证码和认证安全契约", async () => {
  const [screen, api, provider] = await Promise.all([
    source("src/features/me/account-deactivation-screen.tsx"),
    source("src/data/auth/account-deactivation-api.ts"),
    source("src/providers/auth-provider.tsx"),
  ])
  assert.match(screen, /activeAccount\?\.email\?\.trim\(\) \|\| "邮箱不可用"/)
  assert.doesNotMatch(screen, /maskAccountEmail/)
  assert.match(screen, /autoComplete="one-time-code"\s*autoFocus/)
  assert.match(screen, /keyboardType="number-pad"/)
  assert.match(screen, /duration: 0, message: "正在注销账号"/)
  assert.match(screen, /second = requestAnimationFrame\(\(\) => router\.dismissTo\("\/messages"\)\)/)
  assert.match(screen, /cancelAnimationFrame\(second\)/)
  assert.match(api, /createStoredAccountApiClient\(target, accountId\)/)
  assert.match(api, /nonSessionUnauthorizedCodes: \["invalid_code"\]/)
  assert.match(api, /body: JSON\.stringify\(\{ code \}\)/)
  assert.doesNotMatch(api, /JSON\.stringify\(\{ email/)
  assert.doesNotMatch(api, /\?code|\?token|authorization/i)
  assert.match(provider, /await deactivateCurrentAccount\(old\.target, old\.accountId, code\)/)
  const transaction = provider.slice(provider.indexOf("const deactivateActiveAccount"), provider.indexOf("const installAndActivate"))
  assert.match(transaction, /afterLogout: async \(\) => undefined/)
  assert.doesNotMatch(transaction, /queueRevocation/)
  assert.match(transaction, /isSafeAccountDeactivationRejection\(error\)/)
  assert.match(transaction, /markReauthRequired\(accountId\)/)
  assert.doesNotMatch(transaction, /await logout\(/)
})
