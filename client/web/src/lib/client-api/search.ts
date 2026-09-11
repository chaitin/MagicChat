import { ClientDataRequestError, createRequestError, readJson } from "./core"
import { normalizeMessage } from "./message-normalizers"
import type {
  ClientDataErrorEnvelope,
  ClientDataFetch,
  ClientDataSuccessEnvelope,
  ClientMessage,
  MessageResponse,
} from "./types"

export type ClientMessageSearchConversation = {
  avatar: string
  id: string
  name: string
  type: "direct" | "group" | "app" | "topic"
}

export type ClientMessageSearchResult = {
  conversation: ClientMessageSearchConversation
  message: ClientMessage
  senderName: string
  summary: string
}

export type SearchClientMessagesInput = {
  conversationId?: string
  from?: string
  keyword: string
  senderId?: string
  signal?: AbortSignal
  to?: string
}

type MessageSearchConversationResponse = {
  avatar?: string
  id?: string
  name?: string
  type?: string
}

type MessageSearchMessageResponse = MessageResponse & {
  sender_name?: string
  summary?: string
}

type MessageSearchItemResponse = {
  conversation?: MessageSearchConversationResponse
  message?: MessageSearchMessageResponse
}

type SearchMessagesResponse = {
  items?: MessageSearchItemResponse[]
}

export async function searchClientMessages(
  input: SearchClientMessagesInput,
  fetcher: ClientDataFetch = fetch
): Promise<ClientMessageSearchResult[]> {
  const searchParams = new URLSearchParams({ keyword: input.keyword.trim() })
  appendOptionalSearchParam(
    searchParams,
    "conversation_id",
    input.conversationId
  )
  appendOptionalSearchParam(searchParams, "sender_id", input.senderId)
  appendOptionalSearchParam(searchParams, "from", input.from)
  appendOptionalSearchParam(searchParams, "to", input.to)

  const response = await fetcher(
    `/api/client/search/messages?${searchParams.toString()}`,
    {
      credentials: "include",
      method: "GET",
      signal: input.signal,
    }
  )
  const payload = await readJson<
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<SearchMessagesResponse>
  >(response)
  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "搜索聊天记录失败")
  }
  const items = (
    payload as ClientDataSuccessEnvelope<SearchMessagesResponse> | undefined
  )?.data?.items
  if (!Array.isArray(items)) {
    throw new ClientDataRequestError("聊天记录搜索响应格式不正确")
  }
  return items.map(normalizeMessageSearchResult)
}

function appendOptionalSearchParam(
  searchParams: URLSearchParams,
  key: string,
  value: string | undefined
) {
  const normalized = value?.trim()
  if (normalized) {
    searchParams.set(key, normalized)
  }
}

function normalizeMessageSearchResult(
  item: MessageSearchItemResponse
): ClientMessageSearchResult {
  const conversation = item.conversation
  const type = normalizeSearchConversationType(conversation?.type)
  if (
    !conversation?.id ||
    typeof conversation.name !== "string" ||
    typeof conversation.avatar !== "string" ||
    !type ||
    typeof item.message?.sender_name !== "string" ||
    typeof item.message?.summary !== "string"
  ) {
    throw new ClientDataRequestError("聊天记录搜索响应格式不正确")
  }
  return {
    conversation: {
      avatar: conversation.avatar,
      id: conversation.id,
      name: conversation.name,
      type,
    },
    message: normalizeMessage(item.message),
    senderName: item.message.sender_name,
    summary: item.message.summary,
  }
}

function normalizeSearchConversationType(value: string | undefined) {
  switch (value) {
    case "direct":
    case "group":
    case "app":
    case "topic":
      return value
    default:
      return null
  }
}
