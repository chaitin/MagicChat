import type {
  DesktopMessage,
  DesktopMessageBody,
  DesktopMessageChoiceState,
  DesktopMessageReplyTarget,
} from "../../shared/account-data"

export type DesktopMessageDetails = Pick<
  DesktopMessage,
  "body" | "replyTo" | "reactions" | "choice" | "topic" | "virtualType"
>

export function normalizeDesktopMessageDetails(payload: unknown): DesktopMessageDetails {
  const record = asRecord(payload)
  const editableBody = normalizeBody(record?.editable_body, 0)
  const body: DesktopMessageBody = record?.revoked_at
    ? editableBody.type === "text" || editableBody.type === "markdown"
      ? { type: "revoked", editableBody }
      : { type: "revoked" }
    : normalizeBody(record?.body, 0)
  const reply = asRecord(record?.reply_to)
  const replySender = asRecord(reply?.sender)
  const replyId = stringValue(reply?.id)
  const replySenderId = stringValue(replySender?.id)
  const rawReplySenderType = stringValue(replySender?.type)
  const replySenderType =
    rawReplySenderType === "user" || rawReplySenderType === "app" ? rawReplySenderType : undefined
  const replyTo: DesktopMessageReplyTarget | undefined = replyId
    ? {
        id: replyId,
        author:
          stringValue(replySender?.name) ||
          (replySenderType === "app"
            ? "未知应用"
            : rawReplySenderType === "system"
              ? "系统"
              : "未知用户"),
        summary: stringValue(reply?.summary),
        ...(replySenderId && replySenderType
          ? { senderId: replySenderId, senderType: replySenderType }
          : {}),
      }
    : undefined
  const reactions = Array.isArray(record?.reactions)
    ? record.reactions.flatMap((value) => {
        const reaction = asRecord(value)
        const text = stringValue(reaction?.text)
        const count = nonNegativeInteger(reaction?.count)
        const users = Array.isArray(reaction?.users)
          ? reaction.users.flatMap((value) => {
              const user = asRecord(value)
              const id = stringValue(user?.id)
              return id ? [{ id, name: stringValue(user?.name) }] : []
            })
          : []
        return text && count > 0
          ? [{ text, count, reactedByMe: reaction?.reacted_by_me === true, users }]
          : []
      })
    : []
  const choice = normalizeDesktopMessageChoiceState(record?.choice)
  const topicRecord = asRecord(record?.topic)
  const topicId = stringValue(topicRecord?.conversation_id)
  const recentReplies = Array.isArray(topicRecord?.recent_replies)
    ? topicRecord.recent_replies
        .flatMap((value) => {
          const reply = asRecord(value)
          const sender = asRecord(reply?.sender)
          const id = stringValue(reply?.id)
          const createdAt = stringValue(reply?.created_at)
          const senderId = stringValue(sender?.id)
          const senderType: "user" | "app" | null =
            sender?.type === "app" ? "app" : sender?.type === "user" ? "user" : null
          return id && createdAt && senderId && senderType
            ? [
                {
                  id,
                  createdAt,
                  senderId,
                  senderType,
                  summary: stringValue(reply?.summary),
                },
              ]
            : []
        })
        .slice(-3)
    : []
  const topic = topicId
    ? { conversationId: topicId, archived: topicRecord?.archived === true, recentReplies }
    : undefined
  const virtualType = record?.virtual_type === "topic_source" ? "topic_source" : undefined
  return { body, replyTo, reactions, choice, topic, virtualType }
}

export function normalizeDesktopMessageChoiceState(
  value: unknown,
): DesktopMessageChoiceState | undefined {
  const choice = asRecord(value)
  if (!choice || !Array.isArray(choice.my_option_ids) || !Array.isArray(choice.options)) {
    return undefined
  }
  const myOptionIds = choice.my_option_ids.flatMap((value) => {
    const id = stringValue(value)
    return id ? [id] : []
  })
  const options = choice.options.flatMap((value) => {
    const option = asRecord(value)
    const id = stringValue(option?.id)
    return id ? [{ id, responseCount: nonNegativeInteger(option?.response_count) }] : []
  })
  return {
    myOptionIds,
    options,
    responseCount: nonNegativeInteger(choice.response_count),
  }
}

// 摘要口径需要与 client/web 的 formatClientMessageBodySummary 保持一致。
export function summarizeDesktopMessageBody(body: DesktopMessageBody): string {
  switch (body.type) {
    case "text":
      return body.content
    case "markdown":
      return summarizeMarkdownMessageBody(body.content)
    case "choice":
      return `[选择] ${
        body.contentType === "markdown" ? summarizeMarkdownMessageBody(body.content) : body.content
      }`
    case "image":
    case "video": {
      const label = body.type === "image" ? "图片" : "视频"
      const caption = captionSummary(body.caption, body.captionType)
      return caption ? `[${label}] ${caption}` : `[${label}]`
    }
    case "file":
      return `[文件] ${body.name}`
    case "voice":
      return body.transcript ? `[语音] ${body.transcript}` : "[语音]"
    case "link":
      return `[链接] ${body.title}`
    case "card":
      return `[卡片] ${body.title}`
    case "chart":
      return `[图表] ${body.title}`
    case "forward_bundle":
      return forwardBundleSummary(body)
    case "system_event":
      return body.summary
    case "revoked":
      return "该消息已被撤回"
    case "unsupported":
      return "暂不支持查看该消息"
  }
}

function captionSummary(caption: string | undefined, captionType: "text" | "markdown" | undefined) {
  if (!caption) return ""
  return captionType === "markdown" ? summarizeMarkdownMessageBody(caption) : caption
}

function summarizeMarkdownMessageBody(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, (block) =>
      block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/```$/, "")
        .trim(),
    )
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~]+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
}

function forwardBundleSummary(body: Extract<DesktopMessageBody, { type: "forward_bundle" }>) {
  const characters = Array.from(body.items[0]?.summary.trim() ?? "")
  const preview =
    characters.length <= 100 ? characters.join("") : `${characters.slice(0, 100).join("").trim()}…`
  return `[聊天记录] ${body.itemCount} 条 - ${preview || "消息"}`
}

function normalizeBody(value: unknown, depth: number): DesktopMessageBody {
  const body = asRecord(value)
  if (!body) return { type: "unsupported" }
  const type = stringValue(body.type)
  if ((type === "text" || type === "markdown") && typeof body?.content === "string") {
    return { type, content: body.content }
  }
  if (
    type === "choice" &&
    typeof body?.content === "string" &&
    (body.content_type === "text" || body.content_type === "markdown") &&
    (body.selection === "single" || body.selection === "multiple") &&
    Array.isArray(body.options)
  ) {
    const options = body.options.flatMap((value) => {
      const option = asRecord(value)
      const id = stringValue(option?.id)
      const label = stringValue(option?.label)
      return id && label ? [{ id, label }] : []
    })
    if (options.length >= 2) {
      return {
        type: "choice",
        content: body.content,
        contentType: body.content_type,
        selection: body.selection,
        options,
      }
    }
  }
  if (type === "link") {
    const url = stringValue(body?.url)
    if (url) return { type, title: stringValue(body?.title) || url, url }
  }
  if (type === "card") {
    const url = stringValue(body?.url)
    if (url) {
      return {
        type,
        title: stringValue(body?.title),
        description: stringValue(body?.description),
        url,
      }
    }
  }
  if (type === "chart") {
    return {
      type,
      chartType: stringValue(body?.chart_type) || "unknown",
      title: stringValue(body?.title) || "图表",
      description: stringValue(body?.description),
      data: body?.data,
    }
  }
  if (type === "file") {
    const fileId = stringValue(body?.file_id)
    if (fileId) {
      return {
        type,
        fileId,
        name: stringValue(body?.name) || "文件",
        sizeBytes: nonNegativeNumber(body?.size_bytes),
      }
    }
  }
  if (type === "image") {
    const fileId = stringValue(body?.file_id)
    if (fileId) {
      return {
        type,
        fileId,
        ...captionFields(body),
        ...positiveDimensionFields(body),
      }
    }
  }
  if (type === "video") {
    const fileId = stringValue(body?.file_id)
    if (fileId) {
      return {
        type,
        fileId,
        name: stringValue(body?.name) || "视频",
        sizeBytes: nonNegativeNumber(body?.size_bytes),
        contentType: stringValue(body?.content_type) || "video/mp4",
        ...captionFields(body),
      }
    }
  }
  if (type === "voice") {
    const fileId = stringValue(body?.file_id)
    if (fileId) {
      return {
        type,
        fileId,
        sizeBytes: nonNegativeNumber(body?.size_bytes),
        durationMS: nonNegativeNumber(body?.duration_ms),
        contentType: stringValue(body?.content_type) || "audio/webm",
        transcript: stringValue(body?.transcript),
      }
    }
  }
  if (type === "forward_bundle" && depth < 3 && Array.isArray(body?.items)) {
    const items = body.items.flatMap((value) => {
      const item = asRecord(value)
      if (!item) return []
      return [
        {
          senderName: stringValue(item.sender_name) || "未知用户",
          senderType: stringValue(item.sender_type),
          sentAt: stringValue(item.sent_at),
          summary: stringValue(item.summary),
          body: normalizeBody(item.body, depth + 1),
        },
      ]
    })
    return {
      type,
      itemCount: nonNegativeInteger(body.item_count) || items.length,
      items,
    }
  }
  if (type === "system_event") {
    const event = stringValue(body?.event)
    return { type, event, summary: systemEventSummary(event, body) }
  }
  return { type: "unsupported" }
}

function systemEventSummary(event: string, body: Record<string, unknown>) {
  const actor = displayName(body.actor)
  switch (event) {
    case "friendship_created":
      return "你们已成为好友，现在可以开始聊天了"
    case "group_members_invited": {
      const inviter = displayName(body.inviter) || "成员"
      const invitees = Array.isArray(body.invitees)
        ? body.invitees.map(displayName).filter(Boolean)
        : []
      return invitees.length
        ? `${inviter} 邀请 ${invitees.join(",")} 加入群聊`
        : `${inviter}邀请成员加入了群聊`
    }
    case "group_visibility_changed":
      return body.visibility === "public"
        ? `${actor || "管理员"} 将当前群设置为公开群`
        : `${actor || "管理员"} 将当前群设为私有群`
    case "group_member_joined":
      return `${actor || "成员"} 加入群聊`
    case "group_member_left":
      return `${actor || "成员"} 已退出群聊`
    case "group_member_removed":
      return `${actor || "管理员"} 已将 ${displayName(body.target) || "成员"} 移出群聊`
    case "group_name_updated":
      return `${actor || "管理员"} 修改群聊名称为 ${stringValue(body.name)}`
    case "group_announcement_updated":
      return stringValue(body.announcement)
        ? `${actor || "管理员"} 更新了群公告`
        : `${actor || "管理员"} 清空了群公告`
    case "group_avatar_updated":
      return `${actor || "管理员"} 修改了群头像`
    case "topic_closed":
      return `${actor || "管理员"} 已将话题关闭`
    case "message_revoked":
      return `${actor || "成员"} 撤回了一条消息`
    default:
      return "系统消息"
  }
}

function displayName(value: unknown) {
  const record = asRecord(value)
  return stringValue(record?.display_name) || stringValue(record?.name)
}

function captionFields(body: Record<string, unknown>) {
  const caption = stringValue(body.caption)
  return caption
    ? {
        caption,
        captionType: body.caption_type === "markdown" ? ("markdown" as const) : ("text" as const),
      }
    : {}
}

function positiveDimensionFields(body: Record<string, unknown>) {
  const width = positiveNumber(body.width)
  const height = positiveNumber(body.height)
  return { ...(width ? { width } : {}), ...(height ? { height } : {}) }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function nonNegativeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}
