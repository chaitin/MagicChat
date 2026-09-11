import { ApiRequestError } from "@/data/api-client"
import { normalizeChartMessageBody } from "@/data/messages/chart-message-normalizer"
import type {
  ClientForwardableMessageBody,
  ClientMessage,
  ClientMessageBody,
  ClientMessageChoiceState,
  ClientMessagePage,
  ClientMessageReaction,
  ClientMessageReactionUser,
  ClientMessageReplyTo,
  ClientSystemEventMessageBody,
  ClientSystemEventUserRef,
} from "@/core/models"
import { isMessageChoiceStateValidForBody } from "@/domain/messages/message-choices"

const MAX_FORWARD_BUNDLE_DEPTH = 5
const MAX_FORWARD_BUNDLE_ITEMS = 50

export function normalizeClientMessage(value: unknown): ClientMessage {
  const message = asRecord(value)
  const sender = asRecord(message?.sender)
  const senderType = normalizeSenderType(sender?.type)
  const senderId = asString(sender?.id) ?? ""
  const conversationId = asString(message?.conversation_id)
  const createdAt = asString(message?.created_at)
  const id = asString(message?.id)
  const seq = asNumber(message?.seq)
  const revokedAt = asString(message?.revoked_at)

  if (
    !message ||
    !conversationId ||
    !createdAt ||
    !id ||
    !sender ||
    (senderType !== "system" && !senderId) ||
    seq === undefined
  ) {
    throw new ApiRequestError("消息响应格式不正确")
  }

  const normalized: ClientMessage = {
    body: revokedAt
      ? { type: "revoked" }
      : normalizeMessageBodyOrUnsupported(message.body),
    clientMessageId: asString(message.client_message_id) ?? "",
    conversationId,
    createdAt,
    id,
    reactionVersion: normalizeReactionVersion(message.reaction_version),
    reactions: normalizeMessageReactions(message.reactions),
    sender: {
      id: senderId,
      type: senderType,
    },
    seq,
  }
  if (normalized.body.type === "choice") {
    const choice = normalizeMessageChoiceState(message.choice)
    if (!isMessageChoiceStateValidForBody(normalized.body, choice)) {
      throw new ApiRequestError("选择消息状态与选项不匹配")
    }
    normalized.choice = choice
  }
  const delegatedBy = normalizeDelegatedBy(message.delegated_by)
  const replyTo = normalizeReplyTo(message.reply_to)
  const replyToMessageId = asString(message.reply_to_message_id)
  const topic = normalizeMessageTopic(message.topic)

  if (delegatedBy) {
    normalized.delegatedBy = delegatedBy
  }
  if (replyTo) {
    normalized.replyTo = replyTo
  }
  if (replyToMessageId) {
    normalized.replyToMessageId = replyToMessageId
  }
  if (topic) {
    normalized.topic = topic
  }
  if (revokedAt) {
    normalized.revokedAt = revokedAt
    const revokedByUserId = asString(message.revoked_by_user_id)
    if (revokedByUserId) {
      normalized.revokedByUserId = revokedByUserId
    }
  }

  return normalized
}

export function normalizeReactionVersion(value: unknown) {
  if (value === undefined) return 0
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiRequestError("消息表情版本格式不正确")
  }
  return value as number
}

export function normalizeMessageReactions(
  value: unknown
): ClientMessageReaction[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ApiRequestError("消息表情响应格式不正确")
  }

  return value.map((candidate) => {
    const reaction = asRecord(candidate)
    const count = asNumber(reaction?.count)
    const text = asString(reaction?.text)
    const reactedByMe = reaction?.reacted_by_me
    if (
      !reaction ||
      !text ||
      !Number.isSafeInteger(count) ||
      (count ?? 0) <= 0 ||
      (reactedByMe !== undefined && typeof reactedByMe !== "boolean")
    ) {
      throw new ApiRequestError("消息表情响应格式不正确")
    }

    return {
      count: count!,
      reactedByMe: Boolean(reactedByMe),
      text,
      users: normalizeMessageReactionUsers(reaction.users),
    }
  })
}

export function normalizeMessageReactionUsers(
  value: unknown
): ClientMessageReactionUser[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new ApiRequestError("消息表情参与者响应格式不正确")
  }

  return value.map((candidate) => {
    const user = asRecord(candidate)
    const id = asString(user?.id)?.trim()
    const name = asString(user?.name)?.trim() ?? ""
    if (!user || !id) {
      throw new ApiRequestError("消息表情参与者响应格式不正确")
    }
    return { id, name }
  })
}

export function normalizeMessageChoiceState(
  value: unknown
): ClientMessageChoiceState {
  const choice = asRecord(value)
  const myOptionIdsValue = choice?.my_option_ids
  const myOptionIds = myOptionIdsValue === null ? [] : myOptionIdsValue
  const responseCount = asNumber(choice?.response_count)
  if (
    !choice ||
    !Number.isSafeInteger(responseCount) ||
    (responseCount ?? -1) < 0 ||
    !Array.isArray(myOptionIds) ||
    !myOptionIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(myOptionIds).size !== myOptionIds.length ||
    !Array.isArray(choice.options)
  ) {
    throw new ApiRequestError("选择消息状态响应格式不正确")
  }

  const options = choice.options.map((candidate) => {
    const option = asRecord(candidate)
    const id = asString(option?.id)
    const optionResponseCount = asNumber(option?.response_count)
    if (
      !option ||
      !id ||
      !Number.isSafeInteger(optionResponseCount) ||
      (optionResponseCount ?? -1) < 0
    ) {
      throw new ApiRequestError("选择消息状态响应格式不正确")
    }
    return { id, responseCount: optionResponseCount! }
  })
  if (new Set(options.map((option) => option.id)).size !== options.length) {
    throw new ApiRequestError("选择消息状态响应格式不正确")
  }

  return {
    myOptionIds: [...myOptionIds],
    options,
    responseCount: responseCount!,
  }
}

function normalizeMessageTopic(
  value: unknown
): ClientMessage["topic"] | undefined {
  if (value === undefined || value === null) return undefined

  const topic = asRecord(value)
  const conversationId = asString(topic?.conversation_id)
  const replies = Array.isArray(topic?.recent_replies)
    ? topic.recent_replies
    : []
  if (!topic || !conversationId) {
    throw new ApiRequestError("消息话题信息响应格式不正确")
  }

  return {
    archived: Boolean(topic.archived),
    conversationId,
    recentReplies: replies.map((value) => {
      const reply = asRecord(value)
      const sender = asRecord(reply?.sender)
      const createdAt = asString(reply?.created_at)
      const id = asString(reply?.id)
      const senderId = asString(sender?.id)
      const senderType = asString(sender?.type)
      const summary = asString(reply?.summary)
      if (
        !reply ||
        !createdAt ||
        !id ||
        !senderId ||
        (senderType !== "user" && senderType !== "app") ||
        summary === undefined
      ) {
        throw new ApiRequestError("话题回复摘要响应格式不正确")
      }

      return {
        createdAt,
        id,
        sender: { id: senderId, type: senderType },
        summary,
      }
    }),
  }
}

export function normalizeClientMessagePage(value: unknown): ClientMessagePage {
  const page = asRecord(value)
  const limit = asNumber(page?.limit)
  const newestSeq = asNumber(page?.newest_seq)
  const oldestSeq = asNumber(page?.oldest_seq)

  if (!page || limit === undefined || newestSeq === undefined || oldestSeq === undefined) {
    throw new ApiRequestError("消息列表响应格式不正确")
  }

  return {
    hasMoreAfter: Boolean(page.has_more_after),
    hasMoreBefore: Boolean(page.has_more_before),
    limit,
    newestSeq,
    oldestSeq,
  }
}

export function normalizeClientMessageBody(value: unknown): ClientMessageBody {
  return normalizeMessageBodyOrUnsupported(value)
}

function normalizeMessageBodyOrUnsupported(value: unknown): ClientMessageBody {
  try {
    return normalizeMessageBody(value)
  } catch {
    return { type: "unsupported" }
  }
}

function normalizeMessageBody(
  value: unknown,
  forwardBundleDepth = 0
): ClientMessageBody {
  const body = asRecord(value)
  const type = asString(body?.type)

  if (!body || !type) {
    throw new Error("invalid message body")
  }

  if (type === "text" || type === "markdown") {
    const content = asString(body.content)
    if (content === undefined) throw new Error("invalid message body")
    return { content, type }
  }

  if (type === "choice") {
    const content = asString(body.content)
    const contentType = asString(body.content_type)
    const selection = asString(body.selection)
    const options = Array.isArray(body.options) ? body.options : null
    if (
      !content?.trim() ||
      (contentType !== "text" && contentType !== "markdown") ||
      (selection !== "single" && selection !== "multiple") ||
      !options ||
      options.length < 2 ||
      options.length > 20
    ) {
      throw new Error("invalid message body")
    }
    const normalizedOptions = options.map((candidate) => {
      const option = asRecord(candidate)
      const id = asString(option?.id)
      const label = asString(option?.label)
      if (!option || !id || !label) throw new Error("invalid message body")
      return { id, label }
    })
    if (
      new Set(normalizedOptions.map((option) => option.id)).size !==
      normalizedOptions.length
    ) {
      throw new Error("invalid message body")
    }
    return {
      content,
      contentType,
      options: normalizedOptions,
      selection,
      type,
    }
  }

  if (type === "link") {
    const title = asString(body.title)
    const url = asString(body.url)
    if (title === undefined || url === undefined) throw new Error("invalid message body")
    return { title, type, url }
  }

  if (type === "card") {
    const description = asString(body.description)
    const title = asString(body.title)
    const url = asString(body.url)
    if (description === undefined || title === undefined || url === undefined) {
      throw new Error("invalid message body")
    }
    return { description, title, type, url }
  }

  if (type === "chart") {
    return normalizeChartMessageBody(body)
  }

  if (type === "file") {
    const fileId = asString(body.file_id)
    const name = asString(body.name)
    const sizeBytes = asNumber(body.size_bytes)
    if (!fileId || name === undefined || sizeBytes === undefined || sizeBytes < 0) {
      throw new Error("invalid message body")
    }
    return { fileId, name, sizeBytes, type }
  }

  if (type === "image") {
    const fileId = asString(body.file_id)
    if (!fileId) throw new Error("invalid message body")
    const image: Extract<ClientMessageBody, { type: "image" }> = { fileId, type }
    const caption = asString(body.caption)?.trim() ?? ""
    if (caption) {
      image.caption = caption
      image.captionType =
        body.caption_type === "markdown" ? "markdown" : "text"
    }
    const width = asNumber(body.width)
    const height = asNumber(body.height)
    if (width !== undefined && width > 0) image.width = width
    if (height !== undefined && height > 0) image.height = height
    return image
  }

  if (type === "video") {
    const contentType = asString(body.content_type)
    const fileId = asString(body.file_id)
    const name = asString(body.name)
    const sizeBytes = asNumber(body.size_bytes)
    if (
      (contentType !== "video/mp4" && contentType !== "video/webm") ||
      !fileId ||
      !name ||
      !sizeBytes ||
      sizeBytes < 0
    ) {
      throw new Error("invalid message body")
    }
    const caption = asString(body.caption)?.trim() ?? ""
    return {
      ...(caption
        ? {
            caption,
            captionType:
              body.caption_type === "markdown" ? ("markdown" as const) : ("text" as const),
          }
        : {}),
      contentType,
      fileId,
      name,
      sizeBytes,
      type,
    }
  }

  if (type === "voice") {
    const contentType = asString(body.content_type)
    const durationMS = asNumber(body.duration_ms)
    const fileId = asString(body.file_id)
    const sizeBytes = asNumber(body.size_bytes)
    if (
      (contentType !== "audio/webm" && contentType !== "audio/mp4") ||
      !durationMS ||
      durationMS < 0 ||
      durationMS > 60_000 ||
      !fileId ||
      !sizeBytes ||
      sizeBytes < 0
    ) {
      throw new Error("invalid message body")
    }
    return {
      contentType,
      durationMS,
      fileId,
      sizeBytes,
      transcript: asString(body.transcript)?.trim() ?? "",
      type,
    }
  }

  if (type === "forward_bundle") {
    return normalizeForwardBundle(body, forwardBundleDepth)
  }

  if (type === "system_event") {
    return normalizeSystemEvent(body)
  }

  throw new Error("invalid message body")
}

function normalizeForwardBundle(
  body: Record<string, unknown>,
  depth: number
): Extract<ClientMessageBody, { type: "forward_bundle" }> {
  const itemCount = asNumber(body.item_count)
  const items = Array.isArray(body.items) ? body.items : null

  if (
    depth >= MAX_FORWARD_BUNDLE_DEPTH ||
    !itemCount ||
    itemCount > MAX_FORWARD_BUNDLE_ITEMS ||
    !items ||
    items.length !== itemCount
  ) {
    throw new Error("invalid message body")
  }

  return {
    itemCount,
    items: items.map((value) => {
      const item = asRecord(value)
      const senderName = asString(item?.sender_name)?.trim()
      const senderType = asString(item?.sender_type)
      const sentAt = asString(item?.sent_at)
      const summary = asString(item?.summary)
      const itemBody = normalizeMessageBody(item?.body, depth + 1)

      if (
        !item ||
        !senderName ||
        (senderType !== "user" && senderType !== "app") ||
        !sentAt ||
        summary === undefined ||
        !isForwardableBody(itemBody)
      ) {
        throw new Error("invalid message body")
      }

      return { body: itemBody, senderName, senderType, sentAt, summary }
    }),
    type: "forward_bundle",
  }
}

function normalizeSystemEvent(
  body: Record<string, unknown>
): ClientSystemEventMessageBody {
  const event = asString(body.event)

  if (event === "group_members_invited") {
    const inviter = normalizeSystemUser(body.inviter)
    const invitees = Array.isArray(body.invitees)
      ? body.invitees.map(normalizeSystemUser)
      : null
    if (!inviter || !invitees || invitees.some((invitee) => !invitee)) {
      throw new Error("invalid message body")
    }
    return {
      event,
      invitees: invitees as ClientSystemEventUserRef[],
      inviter,
      type: "system_event",
    }
  }

  const actor = normalizeSystemUser(body.actor)
  if (!actor) throw new Error("invalid message body")

  if (
    event === "group_avatar_updated" ||
    event === "group_member_joined" ||
    event === "group_member_left" ||
    event === "message_revoked" ||
    event === "topic_closed"
  ) {
    return { actor, event, type: "system_event" }
  }

  if (event === "group_visibility_changed") {
    return {
      actor,
      event,
      type: "system_event",
      visibility: body.visibility === "public" ? "public" : "private",
    }
  }

  if (event === "group_member_removed") {
    const target = normalizeSystemUser(body.target)
    if (!target) throw new Error("invalid message body")
    return { actor, event, target, type: "system_event" }
  }

  if (event === "group_name_updated") {
    const name = asString(body.name)
    if (name === undefined) throw new Error("invalid message body")
    return { actor, event, name, type: "system_event" }
  }

  throw new Error("invalid message body")
}

function normalizeSystemUser(value: unknown): ClientSystemEventUserRef | null {
  const user = asRecord(value)
  const displayName = asString(user?.display_name)
  const id = asString(user?.id)
  return user && displayName && id ? { displayName, id } : null
}

function normalizeDelegatedBy(value: unknown) {
  if (value === undefined || value === null) return undefined
  const delegated = asRecord(value)
  const id = asString(delegated?.id)
  const name = asString(delegated?.name)
  const type = asString(delegated?.type)
  if (!delegated || !id || !name || (type !== "user" && type !== "app")) {
    throw new ApiRequestError("消息代发信息响应格式不正确")
  }
  return { id, name, type: type as "user" | "app" }
}

export function normalizeClientMessageReply(
  value: unknown
): ClientMessageReplyTo | undefined {
  return normalizeReplyTo(value)
}

function normalizeReplyTo(value: unknown): ClientMessageReplyTo | undefined {
  if (value === undefined || value === null) return undefined
  const reply = asRecord(value)
  const sender = asRecord(reply?.sender)
  const id = asString(reply?.id)
  const senderId = asString(sender?.id) ?? ""
  const senderName = asString(sender?.name) ?? ""
  const senderType = normalizeSenderType(sender?.type)
  const seq = asNumber(reply?.seq)
  const summary = asString(reply?.summary)
  if (
    !reply ||
    !sender ||
    !id ||
    (senderType !== "system" && !senderId) ||
    seq === undefined ||
    summary === undefined
  ) {
    throw new ApiRequestError("消息引用信息响应格式不正确")
  }
  return {
    id,
    sender: { id: senderId, name: senderName, type: senderType },
    seq,
    summary,
  }
}

function isForwardableBody(
  body: ClientMessageBody
): body is ClientForwardableMessageBody {
  return (
    body.type === "text" ||
    body.type === "markdown" ||
    body.type === "link" ||
    body.type === "card" ||
    body.type === "chart" ||
    body.type === "file" ||
    body.type === "image" ||
    body.type === "video" ||
    body.type === "voice" ||
    body.type === "forward_bundle"
  )
}

function normalizeSenderType(value: unknown): "user" | "app" | "system" {
  return value === "app" || value === "system" ? value : "user"
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
