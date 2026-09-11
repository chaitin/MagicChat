import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError } from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"

export type UserBlockStatus = {
  blocked: boolean
  blockedAt?: string
  userId: string
}

type UserBlockStatusResponse = {
  blocked?: boolean
  blocked_at?: string
  user_id?: string
}

export async function getUserBlockStatus(
  target: AuthenticatedTarget,
  userId: string
) {
  return requestUserBlockStatus(target, userId, "GET")
}

export async function blockUser(target: AuthenticatedTarget, userId: string) {
  return requestUserBlockStatus(target, userId, "PUT")
}

export async function unblockUser(target: AuthenticatedTarget, userId: string) {
  return requestUserBlockStatus(target, userId, "DELETE")
}

async function requestUserBlockStatus(
  target: AuthenticatedTarget,
  userId: string,
  method: "DELETE" | "GET" | "PUT"
): Promise<UserBlockStatus> {
  const data = await createProtectedApiClient(target).request<UserBlockStatusResponse>(
    `/api/client/blocked-users/${encodeURIComponent(userId)}`,
    {
      errorMessage:
        method === "PUT"
          ? "加入黑名单失败"
          : method === "DELETE"
            ? "解除黑名单失败"
            : "查询黑名单状态失败",
      method,
    }
  )
  if (
    typeof data?.blocked !== "boolean" ||
    !data.user_id?.trim() ||
    data.user_id.trim().toLowerCase() !== userId.trim().toLowerCase() ||
    (data.blocked && !data.blocked_at?.trim())
  ) {
    throw new ApiRequestError("黑名单状态响应格式不正确")
  }
  return {
    blocked: data.blocked,
    blockedAt: data.blocked_at,
    userId: data.user_id,
  }
}
