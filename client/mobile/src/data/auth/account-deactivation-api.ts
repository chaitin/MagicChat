import type { AuthenticatedTarget } from "@/core/server-target"
import { createProtectedApiClient, createStoredAccountApiClient } from "@/data/protected-api-client"

export type AccountDeactivationCodeResult = {
  expiresInSeconds: number
  retryAfterSeconds: number
}

export async function requestAccountDeactivationCode(target: AuthenticatedTarget): Promise<AccountDeactivationCodeResult> {
  const data = await createProtectedApiClient(target).request<unknown>("/api/client/me/deactivation/code", {
    errorMessage: "发送注销验证码失败",
    method: "POST",
  })
  return parseAccountDeactivationCodeResult(data)
}

export function parseAccountDeactivationCodeResult(data: unknown): AccountDeactivationCodeResult {
  if (!isRecord(data) || !isPositiveInteger(data.expires_in_seconds) || !isNonNegativeInteger(data.retry_after_seconds)) {
    throw new Error("服务器响应格式不正确")
  }
  return { expiresInSeconds: data.expires_in_seconds, retryAfterSeconds: data.retry_after_seconds }
}

export async function deactivateCurrentAccount(target: AuthenticatedTarget, accountId: string, code: string) {
  await createStoredAccountApiClient(target, accountId).request<unknown>("/api/client/me/deactivation", {
    body: JSON.stringify({ code }),
    errorMessage: "注销账号失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    nonSessionUnauthorizedCodes: ["invalid_code"],
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}
