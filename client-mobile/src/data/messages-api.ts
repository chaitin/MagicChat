import { File } from "expo-file-system"

import { ApiRequestError, createApiClient, type ApiFetch } from "@/data/api-client"
import {
  normalizeClientMessage,
  normalizeClientMessagePage,
} from "@/data/message-normalizer"
import type { ClientMessageList } from "@/data/models"
import type { ClientMessageUpload } from "@/data/message-upload"

type ApiOptions = {
  fetcher?: ApiFetch
  signal?: AbortSignal
}

export async function fetchConversationMessages(
  serverUrl: string,
  conversationId: string,
  input: { afterSeq?: number; beforeSeq?: number; limit?: number } = {},
  options: ApiOptions = {}
): Promise<ClientMessageList> {
  const search = new URLSearchParams({ limit: String(input.limit ?? 20) })
  if (input.beforeSeq !== undefined) search.set("before_seq", String(input.beforeSeq))
  if (input.afterSeq !== undefined) search.set("after_seq", String(input.afterSeq))

  const data = await createApiClient(serverUrl, options.fetcher).request<{
    messages?: unknown[]
    page?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages?${search.toString()}`,
    {
      errorMessage: "加载消息失败",
      method: "GET",
      signal: options.signal,
    }
  )

  if (!Array.isArray(data?.messages) || !data.page) {
    throw new ApiRequestError("消息列表响应格式不正确")
  }

  return {
    messages: data.messages.map(normalizeClientMessage),
    page: normalizeClientMessagePage(data.page),
  }
}

export async function sendConversationTextMessage(
  serverUrl: string,
  conversationId: string,
  input: { clientMessageId: string; content: string },
  options: ApiOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<{
    message?: unknown
  }>(`/api/client/conversations/${encodeURIComponent(conversationId)}/messages`, {
    body: JSON.stringify({
      body: { content: input.content, type: "text" },
      client_message_id: input.clientMessageId,
    }),
    errorMessage: "发送消息失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  if (!data?.message) {
    throw new ApiRequestError("发送消息响应格式不正确")
  }

  return normalizeClientMessage(data.message)
}

export function sendConversationFileMessage(
  serverUrl: string,
  conversationId: string,
  input: { clientMessageId: string; file: ClientMessageUpload },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    serverUrl,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      fieldName: "file",
      path: "files",
      upload: input.file,
    },
    "发送文件失败",
    options
  )
}

export function sendConversationImageMessage(
  serverUrl: string,
  conversationId: string,
  input: { clientMessageId: string; image: ClientMessageUpload },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    serverUrl,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      fieldName: "image",
      path: "images",
      upload: input.image,
    },
    "发送图片失败",
    options
  )
}

export function sendConversationVoiceMessage(
  serverUrl: string,
  conversationId: string,
  input: {
    clientMessageId: string
    durationMS: number
    voice: ClientMessageUpload
  },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    serverUrl,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      extraFields: { duration_ms: String(input.durationMS) },
      fieldName: "voice",
      path: "voices",
      upload: input.voice,
    },
    "发送语音失败",
    options
  )
}

export async function markConversationRead(
  serverUrl: string,
  conversationId: string,
  upToSeq: number,
  options: ApiOptions = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<{
    conversation_id?: string
    last_read_seq?: number
    unread_count?: number
  }>(`/api/client/conversations/${encodeURIComponent(conversationId)}/read`, {
    body: JSON.stringify({ up_to_seq: upToSeq }),
    errorMessage: "标记会话已读失败",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal,
  })

  if (
    !data?.conversation_id ||
    typeof data.last_read_seq !== "number" ||
    typeof data.unread_count !== "number"
  ) {
    throw new ApiRequestError("标记会话已读响应格式不正确")
  }

  return {
    conversationId: data.conversation_id,
    lastReadSeq: data.last_read_seq,
    unreadCount: data.unread_count,
  }
}

async function sendConversationUploadMessage(
  serverUrl: string,
  conversationId: string,
  input: {
    clientMessageId: string
    extraFields?: Record<string, string>
    fieldName: "file" | "image" | "voice"
    path: "files" | "images" | "voices"
    upload: ClientMessageUpload
  },
  errorMessage: string,
  options: ApiOptions
) {
  const formData = new FormData()
  const file = new File(input.upload.uri)

  formData.set("client_message_id", input.clientMessageId)
  for (const [name, value] of Object.entries(input.extraFields ?? {})) {
    formData.set(name, value)
  }
  formData.set(input.fieldName, file, input.upload.name)

  const data = await createApiClient(serverUrl, options.fetcher).request<{
    message?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${input.path}`,
    {
      body: formData,
      errorMessage,
      method: "POST",
      signal: options.signal,
      timeoutMs: 120_000,
    }
  )

  if (!data?.message) {
    throw new ApiRequestError(`${errorMessage}：响应格式不正确`)
  }

  return normalizeClientMessage(data.message)
}
