import type { ClientMessage, ClientMessageBody } from "@/core/models"
import type { ClientMessageUpload } from "@/data/messages/message-upload"

export type OptimisticSendDescriptor =
  | { clientMessageId: string; content: string; kind: "text"; replyToMessageId?: string }
  | { cleanup?: () => void; clientMessageId: string; height?: number; kind: "image"; replyToMessageId?: string; upload: ClientMessageUpload; width?: number }
  | { cleanup?: () => void; clientMessageId: string; kind: "file"; replyToMessageId?: string; upload: ClientMessageUpload }
  | { cleanup?: () => void; clientMessageId: string; kind: "video"; replyToMessageId?: string; upload: ClientMessageUpload }
  | { cleanup?: () => void; clientMessageId: string; durationMS: number; kind: "voice"; replyToMessageId?: string; transcript?: string; upload: ClientMessageUpload }

export type OptimisticMessage = {
  descriptor: OptimisticSendDescriptor
  message: ClientMessage
  status: "sending" | "failed"
}

export function createOptimisticMessage(
  userId: string,
  conversationId: string,
  descriptor: OptimisticSendDescriptor,
  seq: number
): ClientMessage {
  return {
    body: createOptimisticBody(descriptor),
    clientMessageId: descriptor.clientMessageId,
    conversationId,
    createdAt: new Date().toISOString(),
    id: `optimistic:${descriptor.clientMessageId}`,
    reactionVersion: 0,
    reactions: [],
    replyToMessageId: descriptor.replyToMessageId,
    sender: { id: userId, type: "user" },
    seq,
  }
}

export function createOptimisticBody(descriptor: OptimisticSendDescriptor): ClientMessageBody {
  switch (descriptor.kind) {
    case "text": return { content: descriptor.content, type: "text" }
    case "image": return { fileId: descriptor.upload.uri, height: descriptor.height, type: "image", width: descriptor.width }
    case "file": return { fileId: descriptor.upload.uri, name: descriptor.upload.name, sizeBytes: descriptor.upload.sizeBytes, type: "file" }
    case "video": return { contentType: descriptor.upload.mimeType === "video/webm" ? "video/webm" : "video/mp4", fileId: descriptor.upload.uri, name: descriptor.upload.name, sizeBytes: descriptor.upload.sizeBytes, type: "video" }
    case "voice": return { contentType: descriptor.upload.mimeType, durationMS: descriptor.durationMS, fileId: descriptor.upload.uri, sizeBytes: descriptor.upload.sizeBytes, transcript: descriptor.transcript?.trim() ?? "", type: "voice" }
  }
}

export function releaseDescriptorCleanup(
  descriptors: Map<string, OptimisticSendDescriptor>,
  clientMessageId: string
) {
  const descriptor = descriptors.get(clientMessageId)
  // Delete first so re-entrant effects and throwing cleanup functions cannot
  // release the same temporary file twice.
  if (!descriptor || !descriptors.delete(clientMessageId)) return false
  try {
    if (descriptor.kind !== "text") descriptor.cleanup?.()
  } catch {
    // Cleanup is best-effort; ownership has still been released exactly once.
  }
  return true
}

export function releaseAllDescriptorCleanups(
  descriptors: Map<string, OptimisticSendDescriptor>
) {
  for (const clientMessageId of Array.from(descriptors.keys())) {
    releaseDescriptorCleanup(descriptors, clientMessageId)
  }
}

export function reconcileOptimisticMessages(
  optimistic: OptimisticMessage[],
  confirmed: ClientMessage[]
) {
  const confirmedIds = new Set(confirmed.map((message) => message.clientMessageId))
  return optimistic.filter(
    ({ message }) => !confirmedIds.has(message.clientMessageId)
  )
}

export function mergeOptimisticMessages(
  confirmed: ClientMessage[],
  optimistic: OptimisticMessage[]
) {
  const pending = reconcileOptimisticMessages(optimistic, confirmed)
  return [
    ...pending.map(({ message }) => message),
    ...confirmed,
  ].sort((left, right) => right.seq - left.seq)
}

export function markOptimisticMessageFailed(
  optimistic: OptimisticMessage[],
  clientMessageId: string,
  confirmed: ClientMessage[]
) {
  if (confirmed.some((message) => message.clientMessageId === clientMessageId)) {
    return reconcileOptimisticMessages(optimistic, confirmed)
  }
  return optimistic.map((item) =>
    item.message.clientMessageId === clientMessageId
      ? { ...item, status: "failed" as const }
      : item
  )
}
