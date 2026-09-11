import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import { createProtectedApiClient, createStoredAccountApiClient } from "@/data/protected-api-client"
import type { PushDelegation } from "@/notifications/push-types"

export async function registerPrivatePushGrant(
  target: AuthenticatedTarget,
  delegation: PushDelegation,
  options: { fetcher?: ApiFetch } = {}
) {
  await createProtectedApiClient(target, options.fetcher).request(
    "/api/client/push/grants",
    {
      body: JSON.stringify({
        expires_at: delegation.expiresAt,
        grant_id: delegation.grantId,
        installation_id: delegation.installationId,
        platform: delegation.platform,
        send_token: delegation.sendToken,
      }),
      errorMessage: "注册手机推送失败",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    }
  )
}

export async function revokePrivatePushGrant(
  target: AuthenticatedTarget,
  accountId: string,
  installationId: string,
  grantId: string,
  options: { fetcher?: ApiFetch } = {}
) {
  await createStoredAccountApiClient(target, accountId, options.fetcher).request(
    `/api/client/push/grants/${encodeURIComponent(installationId)}/revoke`,
    {
      body: JSON.stringify({ grant_id: grantId }),
      errorMessage: "撤销手机推送失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  )
}

export async function resolvePrivatePushRoute(
  target: AuthenticatedTarget,
  routeToken: string,
  options: { fetcher?: ApiFetch } = {}
) {
  const value = await createProtectedApiClient(target, options.fetcher).request<{
    conversation_id?: string
    message_id?: string
  }>("/api/client/push/routes/resolve", {
    body: JSON.stringify({ route_token: routeToken }),
    errorMessage: "打开通知失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  if (!value?.conversation_id || !value.message_id) {
    throw new ApiRequestError("通知路由响应格式不正确")
  }
  return {
    conversationId: value.conversation_id,
    messageId: value.message_id,
  }
}
