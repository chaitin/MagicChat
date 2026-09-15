import type { DesktopContactDirectory } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import {
  AccountDatabase,
  type StoredContactApp,
  type StoredContactGroup,
  type StoredContactUser,
} from "./account-database"
import { AuthenticatedClient } from "./authenticated-client"
import { retryNetworkAction } from "./retry"

type ContactSnapshot = {
  mode: "organization" | "friends"
  userIds: string[]
  groups: StoredContactGroup[]
  apps: StoredContactApp[]
}

export class ContactManager {
  constructor(
    private readonly database: AccountDatabase,
    private readonly client: AuthenticatedClient,
  ) {}

  async initialize() {
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

  getDirectory(): DesktopContactDirectory {
    return this.database.getContacts()
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
  return {
    id: requiredString(value.id, 128, "contact_user.id"),
    name: requiredString(value.name, 256, "contact_user.name"),
    nickname: optionalString(value.nickname, 256),
    avatar: optionalString(value.avatar, 4_096),
    email: optionalString(value.email, 254),
    phone: optionalString(value.phone, 64),
    online: value.online === true,
    updatedAt: requiredString(value.updated_at, 64, "contact_user.updated_at"),
    payload: value,
  }
}

function parseGroup(value: unknown): StoredContactGroup {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "通讯录群组响应格式不正确")
  return {
    id: requiredString(value.id, 128, "contact_group.id"),
    name: requiredString(value.name, 256, "contact_group.name"),
    avatar: optionalString(value.avatar, 4_096),
    joined: value.joined === true,
    memberCount: nonNegativeInteger(value.member_count),
    visibility: optionalString(value.visibility, 32),
    payload: value,
  }
}

function parseApp(value: unknown): StoredContactApp {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "通讯录应用响应格式不正确")
  return {
    id: requiredString(value.id, 128, "contact_app.id"),
    name: requiredString(value.name, 256, "contact_app.name"),
    avatar: optionalString(value.avatar, 4_096),
    description: optionalString(value.description, 4_096),
    online: value.online === true,
    payload: value,
  }
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
