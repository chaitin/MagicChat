import type { AuthenticatedTarget } from "@/core/server-target"
import type { ContactUser, ResolvedClientUser } from "@/core/models"
import {
  ApiRequestError,
  type ApiFetch,
} from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"

type ContactUserResponse = {
  avatar?: string
  email?: string
  id?: string
  last_online_at?: string | null
  name?: string
  nickname?: string
  online?: boolean
  phone?: string
  updated_at?: string
}

type ResolveUsersResponse = {
  users?: ContactUserResponse[]
}

export async function resolveClientUsers(
  target: AuthenticatedTarget,
  userIds: string[],
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
): Promise<ResolvedClientUser[]> {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ResolveUsersResponse
  >("/api/client/users/resolve", {
    body: JSON.stringify({ user_ids: userIds }),
    errorMessage: "加载用户资料失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  if (!data || !Array.isArray(data.users)) {
    throw new ApiRequestError("用户资料响应格式不正确")
  }

  return data.users.map((user) => {
    const profile = normalizeContactUser(user)
    if (!user.updated_at) {
      throw new ApiRequestError("用户资料响应格式不正确")
    }
    return { ...profile, updatedAt: user.updated_at }
  })
}

function normalizeContactUser(user: ContactUserResponse): ContactUser {
  if (!user.email || !user.id || !user.name) {
    throw new ApiRequestError("用户资料响应格式不正确")
  }

  return {
    avatar: user.avatar ?? "",
    email: user.email,
    id: user.id,
    lastOnlineAt: user.last_online_at ?? null,
    name: user.name,
    nickname: user.nickname ?? "",
    online: Boolean(user.online),
    phone: user.phone ?? "",
    type: "user",
  }
}
