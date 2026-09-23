export function createOutgoingTextMessageRequest(input: {
  clientMessageId: string
  content: string
  bodyType: "text" | "markdown" | "link"
  replyToMessageId?: string
}) {
  return {
    client_message_id: input.clientMessageId,
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
    body:
      input.bodyType === "link"
        ? { type: "link" as const, url: input.content }
        : { type: input.bodyType, content: input.content },
  }
}
