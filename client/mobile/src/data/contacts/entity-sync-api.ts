import { readEntitySnapshot, type EntityReference } from "../../../../shared/entity-sync"
import { normalizeContactApp, normalizeContactGroup } from "@/data/contacts/contacts-api"
import { normalizeConversation } from "@/data/conversations/conversations-api"
import { normalizeContactUser } from "@/data/users/user-profiles-api"
import { createProtectedApiClient } from "@/data/protected-api-client"
import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError } from "@/data/api-client"

export async function resolveClientEntities(target: AuthenticatedTarget, entities: EntityReference[]) {
  const data = readEntitySnapshot(await createProtectedApiClient(target).request<unknown>("/api/client/entities/resolve", {
    body: JSON.stringify({ entities }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    errorMessage: "同步资料失败",
  }))
  return {
    ...data,
    users: data.users.map((value) => {
      if (typeof value.updated_at !== "string") throw new ApiRequestError("用户资料响应格式不正确")
      return { ...normalizeContactUser(value), updatedAt: value.updated_at, entityRevision: data.versions[`user:${value.id}`] ?? 0 }
    }),
    apps: data.apps.map((value) => ({ ...normalizeContactApp(value), entityRevision: data.versions[`app:${value.id}`] ?? 0 })),
    groups: data.groups.map((value) => ({ ...normalizeContactGroup(value), entityRevision: data.versions[`group:${value.id}`] ?? 0 })),
    conversations: data.conversations.map(normalizeConversation),
  }
}
