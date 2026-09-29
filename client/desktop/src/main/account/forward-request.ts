import type { ForwardMessagesInput } from "../../shared/account-data"
import { AuthFailure, isRecord } from "../../shared/auth.ts"

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validateForwardRequest(input: Omit<ForwardMessagesInput, "targetId">) {
  if (!input || !uuidPattern.test(input.clientForwardId)) {
    throw new AuthFailure("invalid_forward", "转发操作标识不正确")
  }
  if (input.mode !== "separate" && input.mode !== "merged") {
    throw new AuthFailure("invalid_forward", "转发模式不正确")
  }
  const messageIds = uniqueIds(input.messageIds, 50, "消息")
  const targetConversationIds = uniqueIds(input.targetConversationIds, 20, "目标对话")
  if (input.mode === "merged" && messageIds.length < 2) {
    throw new AuthFailure("invalid_forward", "合并转发至少需要两条消息")
  }
  if (!uuidPattern.test(input.sourceConversationId)) {
    throw new AuthFailure("invalid_forward", "来源对话不正确")
  }
  return { ...input, messageIds, targetConversationIds }
}

function uniqueIds(value: unknown, limit: number, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > limit ||
    value.some((id) => typeof id !== "string" || !uuidPattern.test(id))
  ) {
    throw new AuthFailure("invalid_forward", `${label}数量或标识不正确`)
  }
  return Array.from(new Set(value))
}

export function normalizeForwardResponse<T>(
  data: unknown,
  targetConversationIds: readonly string[],
  parse: (message: unknown, conversationId: string) => T,
) {
  if (
    !isRecord(data) ||
    !Array.isArray(data.results) ||
    data.results.length !== targetConversationIds.length ||
    !Number.isSafeInteger(data.sent_count) ||
    !Number.isSafeInteger(data.failed_count)
  ) {
    throw new AuthFailure("invalid_response", "转发消息响应格式不正确")
  }
  const seen = new Set<string>()
  const results = data.results.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.conversation_id !== "string" ||
      !targetConversationIds.includes(item.conversation_id) ||
      seen.has(item.conversation_id)
    ) {
      throw new AuthFailure("invalid_response", "转发消息响应格式不正确")
    }
    const conversationId = item.conversation_id
    seen.add(conversationId)
    if (item.status === "sent" && Array.isArray(item.messages) && item.messages.length > 0) {
      return {
        conversationId,
        status: "sent" as const,
        messages: item.messages.map((message) => parse(message, conversationId)),
      }
    }
    if (
      item.status === "failed" &&
      isRecord(item.error) &&
      typeof item.error.code === "string" &&
      typeof item.error.message === "string"
    ) {
      return {
        conversationId,
        status: "failed" as const,
        messages: [] as T[],
        error: { code: item.error.code, message: item.error.message },
      }
    }
    throw new AuthFailure("invalid_response", "转发消息响应格式不正确")
  })
  if (
    results.filter((item) => item.status === "sent").length !== data.sent_count ||
    results.filter((item) => item.status === "failed").length !== data.failed_count
  ) {
    throw new AuthFailure("invalid_response", "转发消息响应格式不正确")
  }
  return { sentCount: data.sent_count as number, failedCount: data.failed_count as number, results }
}
