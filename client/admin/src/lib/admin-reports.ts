import { adminFetch } from "@/lib/auth"

export type AdminReportUser = {
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  status: string
}

export type AdminReport = {
  conversationId: string
  createdAt: string
  description: string
  id: string
  reason: string
  reportedUser: AdminReportUser
  reporterUser: AdminReportUser
}

type ReportUserResponse = Partial<{
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  status: string
}>

type AdminReportResponse = Partial<{
  conversation_id: string
  created_at: string
  description: string
  id: string
  reason: string
  reported_user: ReportUserResponse
  reporter_user: ReportUserResponse
}>

type ListReportsResponse = Partial<{
  page: number
  page_size: number
  reports: AdminReportResponse[]
  total: number
}>

type SuccessEnvelope = { data?: ListReportsResponse; success?: boolean }
type ErrorEnvelope = {
  error?: { code?: string; message?: string }
  success?: boolean
}

export const reportReasonLabels: Record<string, string> = {
  fraud: "诈骗",
  harassment_or_abuse: "骚扰或辱骂",
  hate_or_discrimination: "仇恨或歧视",
  illegal_content: "违法违规",
  other: "其他",
  privacy_or_ip_violation: "侵犯隐私或知识产权",
  sexual_content: "色情低俗",
  spam: "垃圾广告",
  violence_or_threat: "暴力或威胁",
}

export class AdminReportRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AdminReportRequestError"
  }
}

type AdminReportsFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export async function listAdminReports(
  input: { page?: number; pageSize?: number } = {},
  fetcher: AdminReportsFetch = adminFetch
) {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  const response = await fetcher(`/api/admin/reports?${params}`, {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<SuccessEnvelope | ErrorEnvelope>(response)
  if (!response.ok || payload?.success === false) {
    const error = (payload as ErrorEnvelope | undefined)?.error
    throw new AdminReportRequestError(error?.message || "加载举报记录失败")
  }
  const data = (payload as SuccessEnvelope | undefined)?.data
  if (!data || !Array.isArray(data.reports)) {
    throw new AdminReportRequestError("举报记录响应格式不正确")
  }
  return {
    page: data.page ?? page,
    pageSize: data.page_size ?? pageSize,
    reports: data.reports.map(normalizeReport),
    total: data.total ?? data.reports.length,
  }
}

function normalizeReport(value: AdminReportResponse): AdminReport {
  if (
    !value.id?.trim() ||
    !value.conversation_id?.trim() ||
    !value.created_at?.trim() ||
    !value.reason?.trim() ||
    !value.reported_user?.id?.trim() ||
    !value.reporter_user?.id?.trim()
  ) {
    throw new AdminReportRequestError("举报记录响应格式不正确")
  }
  return {
    conversationId: value.conversation_id,
    createdAt: value.created_at,
    description: value.description ?? "",
    id: value.id,
    reason: value.reason,
    reportedUser: normalizeUser(value.reported_user),
    reporterUser: normalizeUser(value.reporter_user),
  }
}

function normalizeUser(value: ReportUserResponse): AdminReportUser {
  return {
    avatar: value.avatar ?? "",
    email: value.email ?? "",
    id: value.id ?? "",
    name: value.name ?? "",
    nickname: value.nickname ?? "",
    phone: value.phone ?? "",
    status: value.status ?? "",
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T
  } catch {
    return undefined
  }
}
