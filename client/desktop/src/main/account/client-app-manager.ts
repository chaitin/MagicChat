import type {
  DesktopClientApp,
  DesktopClientAppCredentials,
  SaveClientAppInput,
  UpdateClientAppInput,
} from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth"
import { AuthenticatedClient } from "./authenticated-client"
import { ContactManager } from "./contact-manager"

export class ClientAppManager {
  constructor(
    private readonly client: AuthenticatedClient,
    private readonly contacts: ContactManager,
  ) {}

  async create(input: SaveClientAppInput) {
    const data = await this.client.post("/api/client/apps", appBody(input))
    const credentials = parseCredentials(data)
    await this.contacts.refresh()
    return credentials
  }

  async get(appId: string) {
    return parseCredentials(
      await this.client.get(`/api/client/apps/${encodeURIComponent(validId(appId))}`),
    )
  }

  async update(input: UpdateClientAppInput) {
    const data = await this.client.patch(
      `/api/client/apps/${encodeURIComponent(validId(input.appId))}`,
      appBody(input),
    )
    const app = parseApp(isRecord(data) ? data.app : undefined)
    await this.contacts.refresh()
    return app
  }

  async delete(appId: string) {
    await this.client.delete(`/api/client/apps/${encodeURIComponent(validId(appId))}`)
    await this.contacts.refresh()
  }

  async regenerateSecret(appId: string) {
    return parseCredentials(
      await this.client.post(
        `/api/client/apps/${encodeURIComponent(validId(appId))}/secret/regenerate`,
        {},
      ),
    )
  }

  async uploadAvatar(appId: string, file: { path: string; name: string; contentType: string }) {
    const data = await this.client.postFile(
      `/api/client/apps/${encodeURIComponent(validId(appId))}/avatar`,
      {},
      file,
    )
    const app = parseApp(isRecord(data) ? data.app : undefined)
    await this.contacts.refresh()
    return app
  }
}

function appBody(input: SaveClientAppInput) {
  const name = input.name.trim()
  if (!name || name.length > 256) throw new AuthFailure("invalid_app_name", "应用名称不正确")
  if (input.description.length > 4_096) {
    throw new AuthFailure("invalid_app_description", "应用描述过长")
  }
  if (!(["creator", "public", "restricted"] as const).includes(input.visibility)) {
    throw new AuthFailure("invalid_app_visibility", "应用可见范围不正确")
  }
  const userIds = Array.from(new Set(input.userIds.map(validId)))
  if (input.visibility === "restricted" && userIds.length === 0) {
    throw new AuthFailure("invalid_app_users", "受限应用至少需要一个授权用户")
  }
  return {
    name,
    description: input.description.trim(),
    visibility: input.visibility,
    user_ids: input.visibility === "restricted" ? userIds : [],
  }
}

function parseCredentials(value: unknown): DesktopClientAppCredentials {
  if (!isRecord(value)) throw new AuthFailure("invalid_response", "应用接入信息响应格式不正确")
  return {
    app: parseApp(value.app),
    connectionSecret: requiredString(value.connection_secret, 1_024, "app.connection_secret"),
  }
}

function parseApp(value: unknown): DesktopClientApp {
  if (!isRecord(value) || !Array.isArray(value.user_ids)) {
    throw new AuthFailure("invalid_response", "应用响应格式不正确")
  }
  const visibility = value.visibility
  const connectionStatus = value.connection_status
  return {
    id: requiredString(value.id, 128, "app.id"),
    name: requiredString(value.name, 256, "app.name"),
    description: optionalString(value.description, 4_096),
    avatar: optionalString(value.avatar, 4_096),
    visibility: visibility === "public" || visibility === "restricted" ? visibility : "creator",
    userIds: value.user_ids.map((id) => requiredString(id, 128, "app.user_ids")),
    enabled: value.enabled !== false,
    connectionStatus:
      connectionStatus === "online" || connectionStatus === "disabled"
        ? connectionStatus
        : "offline",
    createdAt: requiredString(value.created_at, 64, "app.created_at"),
    updatedAt: requiredString(value.updated_at, 64, "app.updated_at"),
  }
}

function validId(value: string) {
  if (!value || value.length > 128) throw new AuthFailure("invalid_id", "请求标识不正确")
  return value
}

function requiredString(value: unknown, maximum: number, field: string) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new AuthFailure("invalid_response", `响应字段 ${field} 格式不正确`)
  }
  return value
}

function optionalString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum ? value : ""
}
