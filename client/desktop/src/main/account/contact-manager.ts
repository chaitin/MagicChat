import type {
  DesktopContactDirectory,
  DesktopContactUser,
  DesktopFriendRequest,
} from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import {
  AccountDatabase,
  type StoredContactApp,
  type StoredContactGroup,
  type StoredContactUser,
} from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { retryNetworkAction } from "./retry"
import type { AvatarDescriptor, AvatarMemberDescriptor } from "./avatar-types"

type ContactSnapshot = {
  mode: "organization" | "friends"
  userIds: string[]
  groups: StoredContactGroup[]
  apps: StoredContactApp[]
}

export class ContactManager {
  private readonly refreshedAvatars = new Map<string, AvatarDescriptor>()

  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
  ) {}

  initialize() {
    return this.refresh()
  }

  async refresh() {
    const snapshot = await retryNetworkAction(() => this.fetchDirectory())
    const batches = chunk(snapshot.userIds, 100)
    const users = (
      await mapConcurrent(batches, 4, (userIds) =>
        retryNetworkAction(() => this.resolveUsers(userIds)),
      )
    ).flat()
    this.database.replaceContacts({
      mode: snapshot.mode,
      users,
      groups: snapshot.groups,
      apps: snapshot.apps,
    })
  }

  async applyRealtimeEvent(name: string, payload: unknown): Promise<boolean> {
    if (name === "user.presence.updated") {
      if (!isRecord(payload) || typeof payload.online !== "boolean") {
        throw new AuthFailure("invalid_realtime_event", "用户在线状态推送格式不正确")
      }
      const userId = requiredString(payload.user_id, 128, "event.user_id")
      if (!this.database.setContactUserPresence(userId, payload.online)) {
        await this.refresh()
      }
      return true
    }
    if (
      name === "user.profile.updated" ||
      name === "user.nickname.policy.updated" ||
      name === "friend.request.created" ||
      name === "friend.request.updated" ||
      name === "friendship.created" ||
      name === "friendship.deleted" ||
      name === "contact.directory.mode.updated"
    ) {
      await this.refresh()
      return true
    }
    return false
  }

  getDirectory(): DesktopContactDirectory {
    return this.database.getContacts()
  }

  async refreshAndGetDirectory() {
    await this.refresh()
    return this.getDirectory()
  }

  async searchUsers(query: string): Promise<DesktopContactUser[]> {
    const normalized = query.trim()
    if (!normalized || normalized.length > 256) {
      throw new AuthFailure("invalid_query", "请输入有效的搜索关键词")
    }
    const data = await this.client.post("/api/client/users/search", { query: normalized })
    if (!isRecord(data) || !Array.isArray(data.user_ids)) {
      throw new AuthFailure("invalid_response", "用户查找响应格式不正确")
    }
    const ids = data.user_ids.map((id) => requiredString(id, 128, "search.user_ids"))
    return this.resolveUsers(Array.from(new Set(ids)))
  }

  async listFriendRequests(direction: "incoming" | "outgoing") {
    const data = await this.client.get(
      `/api/client/friend-requests?direction=${encodeURIComponent(direction)}`,
    )
    if (!isRecord(data) || !Array.isArray(data.requests)) {
      throw new AuthFailure("invalid_response", "好友申请响应格式不正确")
    }
    return data.requests.map(parseFriendRequest)
  }

  createFriendRequest(userId: string) {
    return this.mutateFriendRequest("/api/client/friend-requests", "POST", {
      user_id: validId(userId),
    })
  }

  acceptFriendRequest(requestId: string) {
    return this.mutateFriendRequest(
      `/api/client/friend-requests/${encodeURIComponent(validId(requestId))}/accept`,
      "POST",
    )
  }

  rejectFriendRequest(requestId: string) {
    return this.mutateFriendRequest(
      `/api/client/friend-requests/${encodeURIComponent(validId(requestId))}/reject`,
      "POST",
    )
  }

  cancelFriendRequest(requestId: string) {
    return this.mutateFriendRequest(
      `/api/client/friend-requests/${encodeURIComponent(validId(requestId))}`,
      "DELETE",
    )
  }

  async deleteFriend(userId: string) {
    await this.client.delete(`/api/client/friends/${encodeURIComponent(validId(userId))}`)
    await this.refresh()
  }

  getAvatarDescriptor(
    type: "user" | "group" | "app",
    entityId: string,
  ): AvatarDescriptor | undefined {
    return (
      this.refreshedAvatars.get(`${type}:${entityId}`) ??
      avatarDescriptor(type, entityId, this.database.getContactPayload(type, entityId))
    )
  }

  refreshAvatarDescriptor(
    type: "user" | "group" | "app",
    entityId: string,
  ): Promise<AvatarDescriptor | undefined> {
    return retryNetworkAction(async () => {
      let descriptor: AvatarDescriptor | undefined
      if (type === "user") {
        const user = (await this.resolveUsers([entityId]))[0]
        descriptor = avatarDescriptor(type, entityId, user.payload)
      } else {
        const directory = await this.fetchDirectory()
        const entry =
          type === "group"
            ? directory.groups.find((group) => group.id === entityId)
            : directory.apps.find((app) => app.id === entityId)
        descriptor = entry ? avatarDescriptor(type, entityId, entry.payload) : undefined
      }
      if (descriptor) this.refreshedAvatars.set(`${type}:${entityId}`, descriptor)
      return descriptor
    })
  }

  private async mutateFriendRequest(
    path: string,
    method: "DELETE" | "POST",
    body?: Record<string, unknown>,
  ): Promise<DesktopFriendRequest> {
    const data =
      method === "POST" ? await this.client.post(path, body ?? {}) : await this.client.delete(path)
    return parseFriendRequest(data)
  }

  private async fetchDirectory(): Promise<ContactSnapshot> {
    const data = await this.client.get("/api/client/contacts")
    if (
      !isRecord(data) ||
      (data.directory_mode !== "organization" && data.directory_mode !== "friends") ||
      !Array.isArray(data.user_ids) ||
      !Array.isArray(data.groups) ||
      !Array.isArray(data.apps)
    ) {
      throw new AuthFailure("invalid_response", "通讯录响应格式不正确")
    }
    const userIds = Array.from(
      new Set(data.user_ids.map((id) => requiredString(id, 128, "contacts.user_ids"))),
    )
    return {
      mode: data.directory_mode,
      userIds,
      groups: data.groups.map(parseGroup),
      apps: data.apps.map(parseApp),
    }
  }

  private async resolveUsers(userIds: string[]): Promise<StoredContactUser[]> {
    const data = await this.client.post("/api/client/users/resolve", { user_ids: userIds })
    if (!isRecord(data) || !Array.isArray(data.users)) {
      throw new AuthFailure("invalid_response", "通讯录用户响应格式不正确")
    }
    const users = data.users.map(parseUser)
    const resolvedIds = new Set(users.map((user) => user.id))
    if (userIds.some((id) => !resolvedIds.has(id))) {
      throw new AuthFailure("invalid_response", "通讯录用户资料不完整")
    }
    return users
  }
}

function parseUser(value: unknown): StoredContactUser {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "通讯录用户响应格式不正确")
  const id = requiredString(value.id, 128, "contact_user.id")
  return {
    id,
    name: requiredString(value.name, 256, "contact_user.name"),
    nickname: optionalString(value.nickname, 256),
    avatar: optionalString(value.avatar, 4_096),
    avatarType: "user",
    avatarId: id,
    email: optionalString(value.email, 254),
    phone: optionalString(value.phone, 64),
    online: value.online === true,
    lastOnlineAt:
      value.last_online_at === null ? null : optionalString(value.last_online_at, 64) || null,
    updatedAt: requiredString(value.updated_at, 64, "contact_user.updated_at"),
    payload: value,
  }
}

function parseGroup(value: unknown): StoredContactGroup {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "通讯录群组响应格式不正确")
  const id = requiredString(value.id, 128, "contact_group.id")
  return {
    id,
    name: requiredString(value.name, 256, "contact_group.name"),
    avatar: optionalString(value.avatar, 4_096),
    avatarType: "group",
    avatarId: id,
    joined: value.joined === true,
    memberCount: nonNegativeInteger(value.member_count),
    visibility: optionalString(value.visibility, 32),
    payload: value,
  }
}

function parseApp(value: unknown): StoredContactApp {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "通讯录应用响应格式不正确")
  const id = requiredString(value.id, 128, "contact_app.id")
  return {
    id,
    name: requiredString(value.name, 256, "contact_app.name"),
    avatar: optionalString(value.avatar, 4_096),
    avatarType: "app",
    avatarId: id,
    description: optionalString(value.description, 4_096),
    online: value.online === true,
    creatorUserId:
      value.creator_user_id === null ? null : optionalString(value.creator_user_id, 128) || null,
    payload: value,
  }
}

function parseFriendRequest(value: unknown): DesktopFriendRequest {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "好友申请响应格式不正确")
  const status = value.status
  if (
    status !== "pending" &&
    status !== "accepted" &&
    status !== "rejected" &&
    status !== "canceled"
  ) {
    throw new AuthFailure("invalid_response", "好友申请状态不正确")
  }
  return {
    id: requiredString(value.id, 128, "friend_request.id"),
    requesterUserId: requiredString(
      value.requester_user_id,
      128,
      "friend_request.requester_user_id",
    ),
    addresseeUserId: requiredString(
      value.addressee_user_id,
      128,
      "friend_request.addressee_user_id",
    ),
    status,
    createdAt: requiredString(value.created_at, 64, "friend_request.created_at"),
    updatedAt: requiredString(value.updated_at, 64, "friend_request.updated_at"),
    handledAt: value.handled_at === null ? null : optionalString(value.handled_at, 64) || null,
  }
}

function validId(value: string) {
  if (!value || value.length > 128) throw new AuthFailure("invalid_id", "请求标识不正确")
  return value
}

function avatarDescriptor(
  type: "user" | "group" | "app",
  entityId: string,
  value: unknown,
): AvatarDescriptor | undefined {
  if (!isRecord(value)) return undefined
  return {
    type,
    id: entityId,
    name: optionalString(value.nickname, 256) || optionalString(value.name, 256),
    avatarUrl: optionalString(value.avatar, 4_096),
    ...(type === "group" ? { members: parseAvatarMembers(value.avatar_members) } : {}),
  }
}

function parseAvatarMembers(value: unknown): AvatarMemberDescriptor[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((member) => {
    if (!isRecord(member) || typeof member.id !== "string" || !member.id) return []
    const type = member.type === "app" ? "app" : "user"
    const role = member.role === "owner" || member.role === "admin" ? member.role : "member"
    return [
      {
        type,
        id: member.id,
        name: optionalString(member.nickname, 256) || optionalString(member.name, 256),
        avatarUrl: optionalString(member.avatar, 4_096),
        role,
      } satisfies AvatarMemberDescriptor,
    ]
  })
}

function requiredString(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string") {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  const result = value.trim()
  if (!result || result.length > maximum) {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  return result
}

function optionalString(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length <= maximum ? value : ""
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  let index = 0
  const results = new Array<R>(values.length)
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index
      index += 1
      results[current] = await operation(values[current])
    }
  })
  const outcomes = await Promise.allSettled(workers)
  const failure = outcomes.find((outcome) => outcome.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
  return results
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}
