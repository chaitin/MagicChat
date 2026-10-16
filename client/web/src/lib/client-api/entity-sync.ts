import { readEntitySnapshot, type EntityReference } from "../../../../shared/entity-sync"
import { normalizeContactApp, normalizeContactGroup, normalizeContactUser } from "./account"
import { normalizeConversation } from "./conversations"
import { ClientDataRequestError, createRequestError, readJson } from "./core"
import type { ClientDataErrorEnvelope, ClientDataFetch, ClientDataSuccessEnvelope } from "./types"

export async function resolveClientEntities(entities: EntityReference[], fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/entities/resolve", {
    body: JSON.stringify({ entities }), credentials: "include",
    headers: { "Content-Type": "application/json" }, method: "POST",
  })
  const envelope = await readJson<ClientDataErrorEnvelope | ClientDataSuccessEnvelope<unknown>>(response)
  if (!response.ok || envelope?.success === false) throw createRequestError(envelope, response, "同步资料失败")
  const data = readEntitySnapshot((envelope as ClientDataSuccessEnvelope<unknown>)?.data)
  return {
    ...data,
    users: data.users.map((value) => {
      if (typeof value.updated_at !== "string") throw new ClientDataRequestError("用户资料响应格式不正确")
      return { ...normalizeContactUser(value), updatedAt: value.updated_at, entityRevision: data.versions[`user:${value.id}`] ?? 0 }
    }),
    apps: data.apps.map((value) => ({ ...normalizeContactApp(value), entityRevision: data.versions[`app:${value.id}`] ?? 0 })),
    groups: data.groups.map((value) => ({ ...normalizeContactGroup(value), entityRevision: data.versions[`group:${value.id}`] ?? 0 })),
    conversations: data.conversations.map((value) => ({ ...normalizeConversation(value), entityRevision: data.versions[`group:${value.id}`] ?? 0 })),
  }
}
