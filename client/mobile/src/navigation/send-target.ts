import type { AuthenticatedTarget } from "@/core/server-target"
import { createAuthenticatedScopeKey } from "@/data/server-key"
import type { EntityReference } from "@/domain/entities/entity-profile"
import { contactLink, parseContactLink } from "../../../shared/contact-links"

export type SendTargetRequest =
  | { purpose: "forward"; sourceConversationId: string; messageId: string }
  | { purpose: "namecard"; entity: EntityReference }

export type SendTargetParams = Record<string, string | string[] | undefined>

export function sendTargetScope(target: AuthenticatedTarget, generation: number) {
  return JSON.stringify([createAuthenticatedScopeKey(target), generation])
}

export function buildSendTargetHref(target: AuthenticatedTarget, generation: number, request: SendTargetRequest) {
  return {
    pathname: "/send-to" as const,
    params: {
      scope: sendTargetScope(target, generation),
      purpose: request.purpose,
      ...(request.purpose === "forward"
        ? { sourceConversationId: request.sourceConversationId, messageId: request.messageId }
        : { entityType: request.entity.type, entityId: request.entity.id }),
    },
  }
}

export function parseSendTargetRequest(params: SendTargetParams, scope: string): SendTargetRequest | null {
  if (params.scope !== scope) return null
  if (params.purpose === "forward") {
    const { sourceConversationId, messageId } = params
    if (typeof sourceConversationId !== "string" || typeof messageId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(sourceConversationId) || !/^[A-Za-z0-9_-]{1,128}$/.test(messageId)) return null
    return { purpose: "forward", sourceConversationId, messageId }
  }
  if (params.purpose === "namecard") {
    if (params.entityType !== "user" && params.entityType !== "app" && params.entityType !== "group") return null
    if (typeof params.entityId !== "string") return null
    try {
      const entity = parseContactLink(contactLink({ type: params.entityType, id: params.entityId }))
      return entity ? { purpose: "namecard", entity } : null
    } catch { return null }
  }
  return null
}

export function toggleSendTarget(current: ReadonlySet<string>, id: string, purpose: SendTargetRequest["purpose"]) {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else {
    if (purpose === "namecard") next.clear()
    next.add(id)
  }
  return next
}
