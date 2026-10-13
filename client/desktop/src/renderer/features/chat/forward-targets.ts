import type { AccountDataBridge, ForwardMessagesResult } from "../../../shared/account-data.ts"
import {
  resolveConversationTarget,
  type ConversationTargetCandidate,
} from "../../../shared/conversation-targets.ts"

export async function forwardToConversationTargets(
  candidates: ConversationTargetCandidate[],
  targetId: string,
  bridge: Pick<AccountDataBridge, "openContactConversation">,
  resolvedContacts: Map<string, string>,
  forward: (conversationIds: string[]) => Promise<ForwardMessagesResult>,
): Promise<ForwardMessagesResult> {
  const targets = new Map<string, string>()
  const failures = new Map<string, string>()
  for (const candidate of candidates) {
    try {
      targets.set(
        candidate.key,
        await resolveConversationTarget(candidate, targetId, bridge, resolvedContacts),
      )
    } catch (reason) {
      failures.set(candidate.key, reason instanceof Error ? reason.message : "无法打开联系人私聊")
    }
  }
  let response: ForwardMessagesResult | undefined
  if (targets.size) {
    try {
      response = await forward([...new Set(targets.values())])
    } catch (reason) {
      for (const key of targets.keys())
        failures.set(key, reason instanceof Error ? reason.message : "转发失败")
    }
  }
  // 返回稳定候选 key，避免创建私聊使联系人变成会话后，部分成功重试丢失状态。
  const results: ForwardMessagesResult["results"] = candidates.map((candidate) => {
    const item = response?.results.find(
      (result) => result.conversationId === targets.get(candidate.key),
    )
    if (item) return { ...item, conversationId: candidate.key }
    return {
      conversationId: candidate.key,
      status: "failed",
      messages: [],
      error: {
        code: "forward_target_failed",
        message: failures.get(candidate.key) || "转发结果不完整，请重试",
      },
    }
  })
  return {
    results,
    sentCount: results.filter((item) => item.status === "sent").length,
    failedCount: results.filter((item) => item.status === "failed").length,
  }
}
