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
  const text = body.type === "link" ? body.url : summary
  return text ? { type: "text", text } : null
}
