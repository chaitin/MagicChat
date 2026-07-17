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
  ContactAppResponse,
  ContactGroupResponse,
  ClientUser,
  ContactUser,
  ContactApp,
  ContactGroup,
  ContactGroupAvatarMember,
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
    !Array.isArray(data.users)
  ) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    apps: data.apps.map(normalizeContactApp),
    groups: data.groups.map(normalizeContactGroup),
    users: data.users.map(normalizeContactUser),
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
  if (!member?.name) {
    throw new ClientDataRequestError("通讯录群头像成员响应格式不正确")
  }
  return {
    avatar: member.avatar ?? "",
    name: member.name,
    nickname: member.nickname ?? "",
    role:
      member.role === "owner" || member.role === "admin"
        ? member.role
        : ("member" as const),
  }
}
