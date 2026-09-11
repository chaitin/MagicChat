import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"
import type {
  ClientContactDirectory,
  ContactApp,
  ContactGroup,
  ContactGroupAvatarMember,
} from "@/core/models"

type ContactAppResponse = {
  avatar?: string
  creator_user_id?: string | null
  description?: string
  id?: string
  name?: string
  online?: boolean
}

type ContactGroupAvatarMemberResponse = {
  avatar?: string
  id?: string
  name?: string
  nickname?: string
  role?: string
  type?: string
}

type ContactGroupResponse = {
  avatar?: string
  avatar_members?: ContactGroupAvatarMemberResponse[]
  id?: string
  joined?: boolean
  member_count?: number
  name?: string
  visibility?: string
}

type ContactsResponse = {
  apps?: ContactAppResponse[]
  groups?: ContactGroupResponse[]
  user_ids?: string[]
}

export async function fetchContacts(
  target: AuthenticatedTarget,
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    ContactsResponse
  >("/api/client/contacts", {
    errorMessage: "加载通讯录失败",
    method: "GET",
    signal: options.signal,
  })

  if (
    !data ||
    !Array.isArray(data.apps) ||
    !Array.isArray(data.groups) ||
    !Array.isArray(data.user_ids) ||
    data.user_ids.some((id) => typeof id !== "string")
  ) {
    throw new ApiRequestError("通讯录响应格式不正确")
  }

  return {
    apps: data.apps.map(normalizeContactApp),
    groups: data.groups.map(normalizeContactGroup),
    userIds: data.user_ids,
  } satisfies ClientContactDirectory
}

function normalizeContactApp(app: ContactAppResponse): ContactApp {
  if (
    !app.id ||
    !app.name ||
    (app.creator_user_id !== null && typeof app.creator_user_id !== "string")
  ) {
    throw new ApiRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: app.avatar ?? "",
    creatorUserId: app.creator_user_id,
    description: app.description ?? "",
    id: app.id,
    name: app.name,
    online: Boolean(app.online),
    type: "app",
  }
}

function normalizeContactGroup(group: ContactGroupResponse): ContactGroup {
  if (!group.id || !group.name) {
    throw new ApiRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: group.avatar ?? "",
    avatarMembers: (group.avatar_members ?? []).map(
      normalizeContactGroupAvatarMember
    ),
    id: group.id,
    joined: Boolean(group.joined),
    memberCount: group.member_count ?? 0,
    name: group.name,
    type: "group",
    visibility: group.visibility === "public" ? "public" : "private",
  }
}

function normalizeContactGroupAvatarMember(
  member: ContactGroupAvatarMemberResponse
): ContactGroupAvatarMember {
  if (
    !member.id ||
    (member.type !== "user" && member.type !== "app") ||
    (member.type === "app" && !member.name)
  ) {
    throw new ApiRequestError("通讯录群头像成员响应格式不正确")
  }

  return {
    avatar: member.avatar ?? "",
    id: member.id,
    name: member.name ?? "",
    nickname: member.nickname ?? "",
    role:
      member.role === "owner" || member.role === "admin"
        ? member.role
        : "member",
    type: member.type,
  }
}
