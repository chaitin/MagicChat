import type { AuthenticatedTarget } from "@/core/server-target"
import { File } from "expo-file-system"

import { ApiRequestError, type ApiFetch } from "@/data/api-client"
import { createProtectedApiClient } from "@/data/protected-api-client"
import {
  normalizeClientMessage,
  normalizeClientMessagePage,
  normalizeMessageChoiceState,
  normalizeMessageReactions,
  normalizeReactionVersion,
} from "@/data/messages/message-normalizer"
import type {
  ClientMessage,
  ClientMessageList,
  MessageChoiceSnapshot,
  MessageReactionSnapshot,
  SubmitChoiceResponseResult,
} from "@/core/models"
import {
  createVoiceMessageExtraFields,
  type ClientMessageUpload,
} from "@/data/messages/message-upload"

type ApiOptions = {
  fetcher?: ApiFetch
  signal?: AbortSignal
}

export type ForwardConversationMessagesResult = {
  failedCount: number
  results: (
    | {
        conversationId: string
        messages: ClientMessage[]
        status: "sent"
      }
    | {
        conversationId: string
        error: {
          code: string
          message: string
        }
        messages: []
        status: "failed"
      }
  )[]
  sentCount: number
}

export async function fetchConversationMessages(
  target: AuthenticatedTarget,
  conversationId: string,
  input: { afterSeq?: number; beforeSeq?: number; limit?: number } = {},
  options: ApiOptions = {}
): Promise<ClientMessageList> {
  const search = new URLSearchParams({ limit: String(input.limit ?? 20) })
  if (input.beforeSeq !== undefined) search.set("before_seq", String(input.beforeSeq))
  if (input.afterSeq !== undefined) search.set("after_seq", String(input.afterSeq))

  const data = await createProtectedApiClient(target, options.fetcher).request<{
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

  const messages = data.messages.map(normalizeClientMessage)
  if (messages.some((message) => message.conversationId !== conversationId)) {
    throw new ApiRequestError("消息列表响应包含其他会话的消息")
  }

  return {
    messages,
    page: normalizeClientMessagePage(data.page),
  }
}

export async function submitConversationMessageChoiceResponse(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  optionIds: string[],
  options: ApiOptions = {}
): Promise<SubmitChoiceResponseResult> {
  const uniqueOptionIds = [...new Set(optionIds)]
  if (
    uniqueOptionIds.length === 0 ||
    uniqueOptionIds.length !== optionIds.length ||
    uniqueOptionIds.some((id) => id.length === 0)
  ) {
    throw new ApiRequestError("请选择有效选项")
  }

  const data = await createProtectedApiClient(target, options.fetcher).request<{
    choice?: unknown
    conversation_id?: unknown
    created?: unknown
    message_id?: unknown
    response?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/choice-response`,
    {
      body: JSON.stringify({ option_ids: uniqueOptionIds }),
      errorMessage: "提交选择失败",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      signal: options.signal,
    }
  )

  const response = asRecord(data?.response)
  const responseOptionIds = response?.option_ids
  if (
    data?.conversation_id !== conversationId ||
    data.message_id !== messageId ||
    typeof data.created !== "boolean" ||
    !response ||
    !asString(response.id) ||
    !asString(response.created_at) ||
    !asString(response.user_id) ||
    !Array.isArray(responseOptionIds) ||
    !responseOptionIds.every(
      (optionId) => typeof optionId === "string" && optionId.length > 0
    )
  ) {
    throw new ApiRequestError("提交选择响应格式不正确")
  }

  return {
    choice: normalizeMessageChoiceState(data.choice),
    conversationId,
    created: data.created,
    messageId,
    response: {
      createdAt: asString(response.created_at)!,
      id: asString(response.id)!,
      optionIds: [...responseOptionIds],
      userId: asString(response.user_id)!,
    },
  }
}

export async function fetchConversationMessageChoiceSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[],
  options: ApiOptions = {}
): Promise<MessageChoiceSnapshot[]> {
  const uniqueMessageIds = [...new Set(messageIds)]
  if (uniqueMessageIds.length === 0 || uniqueMessageIds.length > 100) {
    throw new ApiRequestError("选择消息快照请求格式不正确")
  }

  const data = await createProtectedApiClient(target, options.fetcher).request<{
    conversation_id?: unknown
    snapshots?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/choices/query`,
    {
      body: JSON.stringify({ message_ids: uniqueMessageIds }),
      errorMessage: "同步选择状态失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    }
  )
  if (
    data?.conversation_id !== conversationId ||
    !Array.isArray(data.snapshots)
  ) {
    throw new ApiRequestError("选择状态快照响应格式不正确")
  }

  const snapshots = data.snapshots.map((candidate) => {
    const snapshot = asRecord(candidate)
    const messageId = asString(snapshot?.message_id)
    const status = asString(snapshot?.status)
    if (
      !snapshot ||
      !messageId ||
      (status !== "active" && status !== "deleted" && status !== "revoked") ||
      (status === "active" && !snapshot.choice)
    ) {
      throw new ApiRequestError("选择状态快照响应格式不正确")
    }
    return {
      choice:
        status === "active"
          ? normalizeMessageChoiceState(snapshot.choice)
          : null,
      conversationId,
      messageId,
      status,
    } satisfies MessageChoiceSnapshot
  })
  if (
    snapshots.length !== uniqueMessageIds.length ||
    snapshots.some(
      (snapshot, index) => snapshot.messageId !== uniqueMessageIds[index]
    )
  ) {
    throw new ApiRequestError("选择状态快照响应格式不正确")
  }
  return snapshots
}

export async function setConversationMessageReaction(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  input: { reacted: boolean; text: string },
  options: ApiOptions = {}
): Promise<MessageReactionSnapshot> {
  const data = await createProtectedApiClient(target, options.fetcher).request<{
    conversation_id?: unknown
    message_id?: unknown
    reaction_version?: unknown
    reactions?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      body: JSON.stringify({ reacted: input.reacted, text: input.text }),
      errorMessage: "更新消息表情失败",
      headers: { "Content-Type": "application/json" },
      method: "PUT",
      signal: options.signal,
    }
  )

  return normalizeReactionSnapshot(data, conversationId, messageId, true)
}

export async function fetchConversationMessageReactionSnapshots(
  target: AuthenticatedTarget,
  conversationId: string,
  messageIds: string[],
  options: ApiOptions = {}
): Promise<MessageReactionSnapshot[]> {
  const uniqueMessageIds = [...new Set(messageIds)]
  const data = await createProtectedApiClient(target, options.fetcher).request<{
    conversation_id?: unknown
    snapshots?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/reactions/query`,
    {
      body: JSON.stringify({ message_ids: uniqueMessageIds }),
      errorMessage: "同步消息表情失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    }
  )

  if (
    data?.conversation_id !== conversationId ||
    !Array.isArray(data.snapshots)
  ) {
    throw new ApiRequestError("消息表情快照响应格式不正确")
  }

  const snapshots = data.snapshots.map((value, index) =>
    normalizeReactionSnapshot(
      value,
      conversationId,
      uniqueMessageIds[index] ?? ""
    )
  )
  if (
    snapshots.length !== uniqueMessageIds.length ||
    snapshots.some(
      (snapshot, index) => snapshot.messageId !== uniqueMessageIds[index]
    )
  ) {
    throw new ApiRequestError("消息表情快照响应格式不正确")
  }

  return snapshots
}

export async function sendConversationTextMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    content: string
    replyToMessageId?: string
  },
  options: ApiOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<{
    message?: unknown
  }>(`/api/client/conversations/${encodeURIComponent(conversationId)}/messages`, {
    body: JSON.stringify({
      body: { content: input.content, type: "text" },
      client_message_id: input.clientMessageId,
      reply_to_message_id: input.replyToMessageId,
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
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    file: ClientMessageUpload
    replyToMessageId?: string
  },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    target,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      fieldName: "file",
      path: "files",
      replyToMessageId: input.replyToMessageId,
      upload: input.file,
    },
    "发送文件失败",
    options
  )
}

export function sendConversationImageMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    image: ClientMessageUpload
    replyToMessageId?: string
  },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    target,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      fieldName: "image",
      path: "images",
      replyToMessageId: input.replyToMessageId,
      upload: input.image,
    },
    "发送图片失败",
    options
  )
}

export function sendConversationVideoMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    replyToMessageId?: string
    video: ClientMessageUpload
  },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    target,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      fieldName: "video",
      path: "videos",
      replyToMessageId: input.replyToMessageId,
      timeoutMs: 10 * 60_000,
      upload: input.video,
    },
    "发送视频失败",
    options
  )
}

export function sendConversationVoiceMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    durationMS: number
    replyToMessageId?: string
    transcript?: string
    voice: ClientMessageUpload
  },
  options: ApiOptions = {}
) {
  return sendConversationUploadMessage(
    target,
    conversationId,
    {
      clientMessageId: input.clientMessageId,
      extraFields: createVoiceMessageExtraFields(
        input.durationMS,
        input.transcript
      ),
      fieldName: "voice",
      path: "voices",
      replyToMessageId: input.replyToMessageId,
      upload: input.voice,
    },
    "发送语音失败",
    options
  )
}

export async function markConversationRead(
  target: AuthenticatedTarget,
  conversationId: string,
  upToSeq: number,
  options: ApiOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<{
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

export async function revokeConversationMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  messageId: string,
  options: ApiOptions = {}
) {
  const data = await createProtectedApiClient(target, options.fetcher).request<{
    message?: unknown
    system_message?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/revoke`,
    {
      errorMessage: "撤回消息失败",
      method: "POST",
      signal: options.signal,
    }
  )

  if (!data?.message || !data.system_message) {
    throw new ApiRequestError("撤回消息响应格式不正确")
  }

  return {
    message: normalizeClientMessage(data.message),
    systemMessage: normalizeClientMessage(data.system_message),
  }
}

export async function forwardConversationMessages(
  target: AuthenticatedTarget,
  sourceConversationId: string,
  input: {
    clientForwardId: string
    messageIds: string[]
    targetConversationIds: string[]
  },
  options: ApiOptions = {}
): Promise<ForwardConversationMessagesResult> {
  const data = await createProtectedApiClient(target, options.fetcher).request<{
    failed_count?: unknown
    results?: unknown
    sent_count?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(sourceConversationId)}/messages/forward`,
    {
      body: JSON.stringify({
        client_forward_id: input.clientForwardId,
        message_ids: input.messageIds,
        mode: "separate",
        target_conversation_ids: input.targetConversationIds,
      }),
      errorMessage: "转发消息失败",
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: options.signal,
    }
  )

  if (
    typeof data?.sent_count !== "number" ||
    typeof data.failed_count !== "number" ||
    !Array.isArray(data.results)
  ) {
    throw new ApiRequestError("转发消息响应格式不正确")
  }

  const results = data.results.map((value) => {
    const result = asRecord(value)
    const conversationId = asString(result?.conversation_id)
    const status = asString(result?.status)
    if (
      !conversationId ||
      (status !== "sent" && status !== "failed")
    ) {
      throw new ApiRequestError("转发消息响应格式不正确")
    }

    if (status === "sent") {
      if (!Array.isArray(result?.messages)) {
        throw new ApiRequestError("转发消息响应格式不正确")
      }
      return {
        conversationId,
        messages: result.messages.map(normalizeClientMessage),
        status,
      } as const
    }

    const error = asRecord(result?.error)
    const code = asString(error?.code)
    const message = asString(error?.message)
    if (!code || !message) {
      throw new ApiRequestError("转发消息响应格式不正确")
    }
    return {
      conversationId,
      error: { code, message },
      messages: [] as [],
      status,
    } as const
  })

  return {
    failedCount: data.failed_count,
    results,
    sentCount: data.sent_count,
  }
}

async function sendConversationUploadMessage(
  target: AuthenticatedTarget,
  conversationId: string,
  input: {
    clientMessageId: string
    extraFields?: Record<string, string>
    fieldName: "file" | "image" | "video" | "voice"
    path: "files" | "images" | "videos" | "voices"
    replyToMessageId?: string
    timeoutMs?: number
    upload: ClientMessageUpload
  },
  errorMessage: string,
  options: ApiOptions
) {
  const formData = new FormData()
  const file = new File(input.upload.uri)

  formData.set("client_message_id", input.clientMessageId)
  if (input.replyToMessageId) {
    formData.set("reply_to_message_id", input.replyToMessageId)
  }
  for (const [name, value] of Object.entries(input.extraFields ?? {})) {
    formData.set(name, value)
  }
  if (input.fieldName === "voice") {
    formData.set(
      input.fieldName,
      createTypedFilePart(file, input.upload)
    )
  } else {
    formData.set(input.fieldName, file, input.upload.name)
  }

  const data = await createProtectedApiClient(target, options.fetcher).request<{
    message?: unknown
  }>(
    `/api/client/conversations/${encodeURIComponent(conversationId)}/messages/${input.path}`,
    {
      body: formData,
      errorMessage,
      method: "POST",
      signal: options.signal,
      timeoutMs: input.timeoutMs ?? 120_000,
    }
  )

  if (!data?.message) {
    throw new ApiRequestError(`${errorMessage}：响应格式不正确`)
  }

  return normalizeClientMessage(data.message)
}

function createTypedFilePart(
  file: File,
  upload: ClientMessageUpload
): Blob {
  // Expo Fetch accepts file-like values with bytes(), name and type. Android
  // otherwise classifies .webm as video/webm instead of the required audio MIME.
  return {
    bytes: () => file.bytes(),
    name: upload.name,
    type: upload.mimeType,
  } as unknown as Blob
}

function normalizeReactionSnapshot(
  value: unknown,
  expectedConversationId: string,
  expectedMessageId: string,
  requireConversationId = false
): MessageReactionSnapshot {
  const snapshot = asRecord(value)
  const responseConversationId = asString(snapshot?.conversation_id)
  const messageId = asString(snapshot?.message_id)
  if (
    !snapshot ||
    (requireConversationId && responseConversationId !== expectedConversationId) ||
    (responseConversationId !== undefined &&
      responseConversationId !== expectedConversationId) ||
    messageId !== expectedMessageId ||
    !Number.isSafeInteger(snapshot.reaction_version) ||
    (snapshot.reaction_version as number) < 0
  ) {
    throw new ApiRequestError("消息表情快照响应格式不正确")
  }

  return {
    conversationId: expectedConversationId,
    messageId,
    reactionVersion: normalizeReactionVersion(snapshot.reaction_version),
    reactions: normalizeMessageReactions(snapshot.reactions),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}
