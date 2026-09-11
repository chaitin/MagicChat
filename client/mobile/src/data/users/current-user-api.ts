import type { AuthenticatedTarget } from "@/core/server-target"
import { File } from "expo-file-system"

import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import {
  createProtectedApiClient,
  createStoredAccountApiClient,
} from "@/data/protected-api-client"
import type { ClientUser } from "@/core/models"
import { createNicknameRequest } from "@/domain/users/profile-edit"

type CurrentUserResponse = {
  user?: {
    avatar?: string
    created_at?: string
    email?: string
    id?: string
    last_online_at?: string | null
    name?: string
    nickname?: string
    phone?: string
    status?: string
  }
}

export async function updateCurrentUserNickname(
  target: AuthenticatedTarget,
  nickname: string,
  options: { fetcher?: ApiFetch } = {}
) {
  await createProtectedApiClient(target, options.fetcher).request("/api/client/me", {
    ...createNicknameRequest(nickname),
    errorMessage: "修改昵称失败",
  })
}

export async function uploadCurrentUserAvatar(
  target: AuthenticatedTarget,
  uri: string,
  options: { fetcher?: ApiFetch } = {}
) {
  const formData = new FormData()
  formData.set("file", new File(uri), "avatar.webp")
  await createProtectedApiClient(target, options.fetcher).request(
    "/api/client/me/avatar",
    { body: formData, errorMessage: "上传头像失败", method: "POST" }
  )
}

export async function fetchCurrentUser(
  target: AuthenticatedTarget,
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    CurrentUserResponse
  >("/api/client/me", {
    errorMessage: "加载当前用户失败",
    method: "GET",
    signal: options.signal,
  })
  return normalizeCurrentUser(data)
}

export async function fetchStoredCurrentUser(
  target: AuthenticatedTarget,
  accountId: string,
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
) {
  const data = await createStoredAccountApiClient(
    target,
    accountId,
    options.fetcher
  ).request<CurrentUserResponse>("/api/client/me", {
    errorMessage: "加载账号资料失败",
    method: "GET",
    signal: options.signal,
  })
  return normalizeCurrentUser(data)
}

function normalizeCurrentUser(data: CurrentUserResponse | undefined) {
  const user = data?.user
  if (!user?.created_at || !user.email || !user.id || !user.name) {
    throw new ApiRequestError("当前用户响应格式不正确")
  }

  return {
    avatar: user.avatar ?? "",
    createdAt: user.created_at,
    email: user.email,
    id: user.id,
    lastOnlineAt: user.last_online_at ?? null,
    name: user.name,
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
    status: user.status === "disabled" ? "disabled" : "active",
  } satisfies ClientUser
}
