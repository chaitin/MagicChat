import type { AuthenticatedTarget } from "@/core/server-target"
import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"

export const USER_REPORT_REASONS = [
  { label: "色情低俗", value: "sexual_content" },
  { label: "暴力或威胁", value: "violence_or_threat" },
  { label: "骚扰或辱骂", value: "harassment_or_abuse" },
  { label: "仇恨或歧视", value: "hate_or_discrimination" },
  { label: "诈骗", value: "fraud" },
  { label: "垃圾广告", value: "spam" },
  { label: "违法违规", value: "illegal_content" },
  { label: "侵犯隐私或知识产权", value: "privacy_or_ip_violation" },
  { label: "其他", value: "other" },
] as const

export type UserReportReason = (typeof USER_REPORT_REASONS)[number]["value"]

type CreateUserReportResponse = {
  report?: {
    conversation_id?: string
    created_at?: string
    description?: string
    id?: string
    reason?: string
    reported_user_id?: string
  }
}

type CreateUserReportOptions = {
  fetcher?: ApiFetch
}

export async function createUserReport(
  target: AuthenticatedTarget,
  input: {
    conversationId: string
    description: string
    reason: UserReportReason
  },
  options: CreateUserReportOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<
    CreateUserReportResponse
  >(
    `/api/client/conversations/${encodeURIComponent(input.conversationId)}/reports`,
    {
      body: JSON.stringify({
        description: input.description.trim(),
        reason: input.reason,
      }),
      errorMessage: "提交举报失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  )
  const report = data?.report
  if (
    !report?.id?.trim() ||
    !report.conversation_id?.trim() ||
    !report.reported_user_id?.trim() ||
    !report.reason?.trim() ||
    !report.created_at?.trim()
  ) {
    throw new ApiRequestError("举报响应格式不正确")
  }
  return {
    conversationId: report.conversation_id,
    createdAt: report.created_at,
    description: report.description ?? "",
    id: report.id,
    reason: report.reason,
    reportedUserId: report.reported_user_id,
  }
}
