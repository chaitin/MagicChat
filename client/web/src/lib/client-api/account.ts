import {
  ClientDataRequestError,
  createRequestError,
  normalizeVisibility,
  readJson,
} from "./core"
import type {
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientDataErrorEnvelope,
  ClientUserResponse,
  CurrentClientUserResponse,
  UploadCurrentClientAvatarResponse,
  UpdateCurrentClientUserInput,
  ContactUserResponse,
  ListClientContactsResponse,
  ResolveClientUsersResponse,
  ContactAppResponse,
  ContactGroupResponse,
  ClientUser,
  ContactUser,
  ContactApp,
  ContactGroup,
  ContactGroupAvatarMember,
  FriendRequest,
  FriendRequestResponse,
  ListFriendRequestsResponse,
  SearchContactUsersResponse,
  ResolvedClientUser,
} from "./types"

export async function getCurrentClientUser(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/me", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载当前用户失败")
  }

  const user = (
    payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined
  )?.data?.user

  return normalizeClientUser(user)
}

export async function updateCurrentClientUser(
  input: UpdateCurrentClientUserInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/me", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "更新个人信息失败")
  }

  const user = (
    payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined
  )?.data?.user

  return normalizeClientUser(user)
}

export async function uploadCurrentClientAvatar(
  file: File,
  fetcher: ClientDataFetch = fetch
) {
  const formData = new FormData()
  formData.set("file", file)

  const response = await fetcher("/api/client/me/avatar", {
    body: formData,
    credentials: "include",
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<UploadCurrentClientAvatarResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "上传头像失败")
  }

  const user = (
    payload as
      ClientDataSuccessEnvelope<UploadCurrentClientAvatarResponse> | undefined
  )?.data?.user

  return normalizeClientUser(user)
}

export async function resolveClientUsers(
  userIds: string[],
  fetcher: ClientDataFetch = fetch
): Promise<ResolvedClientUser[]> {
  const response = await fetcher("/api/client/users/resolve", {
    body: JSON.stringify({ user_ids: userIds }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ResolveClientUsersResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载用户资料失败")
  }
  const users = (
    payload as ClientDataSuccessEnvelope<ResolveClientUsersResponse> | undefined
  )?.data?.users
  if (!Array.isArray(users)) {
    throw new ClientDataRequestError("用户资料响应格式不正确")
  }
  return users.map((user) => {
    const profile = normalizeContactUser(user)
    if (!user.updated_at) {
      throw new ClientDataRequestError("用户资料响应格式不正确")
    }
    return { ...profile, updatedAt: user.updated_at }
  })
}

export async function listClientContacts(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/contacts", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ListClientContactsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载通讯录失败")
  }

  const data = (
    payload as ClientDataSuccessEnvelope<ListClientContactsResponse> | undefined
  )?.data

  if (
    !data ||
    !Array.isArray(data.apps) ||
    !Array.isArray(data.groups) ||
    !Array.isArray(data.user_ids) ||
    data.user_ids.some((id) => typeof id !== "string")
  ) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  if (
    data.directory_mode !== "organization" &&
    data.directory_mode !== "friends"
  ) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    apps: data.apps.map(normalizeContactApp),
    directoryMode: data.directory_mode,
    groups: data.groups.map(normalizeContactGroup),
    userIds: data.user_ids,
  }
}

export async function searchContactUsers(
  query: string,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/users/search", {
    body: JSON.stringify({ query }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<SearchContactUsersResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "查找用户失败")
  }
  const userIds = (
    payload as ClientDataSuccessEnvelope<SearchContactUsersResponse> | undefined
  )?.data?.user_ids
  if (!Array.isArray(userIds) || userIds.some((id) => typeof id !== "string")) {
    throw new ClientDataRequestError("用户查找响应格式不正确")
  }
  return userIds
}

export async function listFriendRequests(
  direction: "incoming" | "outgoing",
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher(
    `/api/client/friend-requests?direction=${direction}`,
    { credentials: "include", method: "GET" }
  )
  return readFriendRequestList(response, "加载好友申请失败")
}

export function createFriendRequest(userId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest("/api/client/friend-requests", "POST", { user_id: userId }, fetcher)
}

export function acceptFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(`/api/client/friend-requests/${encodeURIComponent(requestId)}/accept`, "POST", undefined, fetcher)
}

export function rejectFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(`/api/client/friend-requests/${encodeURIComponent(requestId)}/reject`, "POST", undefined, fetcher)
}

export function cancelFriendRequest(requestId: string, fetcher: ClientDataFetch = fetch) {
  return mutateFriendRequest(`/api/client/friend-requests/${encodeURIComponent(requestId)}`, "DELETE", undefined, fetcher)
}

export async function deleteFriend(userId: string, fetcher: ClientDataFetch = fetch) {
  const response = await fetcher(`/api/client/friends/${encodeURIComponent(userId)}`, {
    credentials: "include",
    method: "DELETE",
  })
  const payload = await readJson<ClientDataErrorEnvelope | ClientDataSuccessEnvelope<{ user_id?: string }>>(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "删除好友失败")
  }
}

async function readFriendRequestList(response: Response, fallback: string) {
  const payload = await readJson<ClientDataErrorEnvelope | ClientDataSuccessEnvelope<ListFriendRequestsResponse>>(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, fallback)
  }
  const requests = (payload as ClientDataSuccessEnvelope<ListFriendRequestsResponse> | undefined)?.data?.requests
  if (!Array.isArray(requests)) throw new ClientDataRequestError("好友申请响应格式不正确")
  return requests.map(normalizeFriendRequest)
}

async function mutateFriendRequest(
  url: string,
  method: "DELETE" | "POST",
  body: Record<string, string> | undefined,
  fetcher: ClientDataFetch
) {
  const response = await fetcher(url, {
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
    credentials: "include",
    method,
  })
  const payload = await readJson<ClientDataErrorEnvelope | ClientDataSuccessEnvelope<FriendRequestResponse>>(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "好友操作失败")
  }
  return normalizeFriendRequest((payload as ClientDataSuccessEnvelope<FriendRequestResponse> | undefined)?.data)
}

function normalizeFriendRequest(value: FriendRequestResponse | undefined): FriendRequest {
  if (
    !value?.id ||
    !value.requester_user_id ||
    !value.addressee_user_id ||
    !value.created_at ||
    !value.updated_at ||
    (value.status !== "pending" && value.status !== "accepted" && value.status !== "rejected" && value.status !== "canceled")
  ) {
    throw new ClientDataRequestError("好友申请响应格式不正确")
  }
  return {
    addresseeUserId: value.addressee_user_id,
    createdAt: value.created_at,
    handledAt: value.handled_at ?? null,
    id: value.id,
    requesterUserId: value.requester_user_id,
    status: value.status,
    updatedAt: value.updated_at,
  }
}

function normalizeClientUser(user: ClientUserResponse | undefined): ClientUser {
  if (!user?.created_at || !user.email || !user.id || !user.name) {
    throw new ClientDataRequestError("当前用户响应格式不正确")
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
  }
}

function normalizeContactUser(
  contact: ContactUserResponse | undefined
): ContactUser {
  if (!contact?.email || !contact.id || !contact.name) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: contact.avatar ?? "",
    email: contact.email,
    id: contact.id,
    lastOnlineAt: contact.last_online_at ?? null,
    name: contact.name,
    nickname: contact.nickname ?? "",
    online: Boolean(contact.online),
    phone: contact.phone ?? "",
    type: "user",
  }
}

function normalizeContactApp(app: ContactAppResponse | undefined): ContactApp {
  if (
    !app?.id ||
    !app.name ||
    (app.creator_user_id !== null && typeof app.creator_user_id !== "string")
  ) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
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

function normalizeContactGroup(
  group: ContactGroupResponse | undefined
): ContactGroup {
  if (!group?.id || !group.name) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
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
    visibility: normalizeVisibility(group.visibility),
  }
}

function normalizeContactGroupAvatarMember(
  member:
    NonNullable<ContactGroupResponse["avatar_members"]>[number] | undefined
): ContactGroupAvatarMember {
  if (
    !member?.id ||
    (member.type !== "user" && member.type !== "app") ||
    (member.type === "app" && !member.name)
  ) {
    throw new ClientDataRequestError("通讯录群头像成员响应格式不正确")
  }
  return {
    avatar: member.avatar ?? "",
    id: member.id,
    name: member.name ?? "",
    nickname: member.nickname ?? "",
    role:
      member.role === "owner" || member.role === "admin"
        ? member.role
        : ("member" as const),
    type: member.type,
  }
}
