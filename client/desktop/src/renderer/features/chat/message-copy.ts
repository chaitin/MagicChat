import type { DesktopMessage } from "../../../shared/account-data"

export type MessageCopyPayload = { type: "text"; text: string } | { type: "image"; fileId: string }

export function resolveMessageCopyPayload(
  message: DesktopMessage,
  selectedText: string,
): MessageCopyPayload | null {
  return resolveMessageBodyCopyPayload(message.body, message.content, selectedText)
}

export function resolveMessageBodyCopyPayload(
  body: DesktopMessage["body"],
  summary: string,
  selectedText: string,
): MessageCopyPayload | null {
  if (selectedText.trim()) return { type: "text", text: selectedText }
  if (body.type === "image") return { type: "image", fileId: body.fileId }
  const text = copyTextForBody(body, summary)
  return text ? { type: "text", text } : null
}

// 消息摘要带类型前缀（如 [文件]），复制时按类型取原文。
function copyTextForBody(body: DesktopMessage["body"], summary: string) {
  switch (body.type) {
    case "link":
      return body.url
    case "file":
      return body.name
    case "voice":
      return body.transcript
    case "card":
    case "chart":
      return body.title
    default:
      return summary
  }
}
