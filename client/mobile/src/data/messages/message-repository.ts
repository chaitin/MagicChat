import type { ClientMessage, ClientMessageList } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import {
  getMessageSyncState,
  persistAfterHttpPage,
  persistBeforeHttpPage,
  persistLatestHttpPage,
  persistRealtimeMessages,
  readCachedMessagesBefore,
  readLatestCachedMessages,
  type MessageSyncState,
} from "@/data/messages/message-cache-store"
import { fetchConversationMessages } from "@/data/messages/messages-api"

/**
 * Message persistence boundary. These methods are deliberately policy-free:
 * every failure is propagated and callers choose fallback, telemetry and retry.
 */
export const messageRepository = {
  fetchAfterRemote,
  fetchBeforeRemote,
  fetchLatestRemote,
  persistAfter,
  persistBefore,
  persistLatest,
  persistMessages,
  readBeforeLocal,
  readLatestLocal,
  readSyncStateLocal,
}

export function readLatestLocal(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number
): Promise<ClientMessage[]> {
  return readLatestCachedMessages(target, conversationId, limit)
}

export function readBeforeLocal(
  target: AuthenticatedTarget,
  conversationId: string,
  beforeSeq: number,
  limit: number
): Promise<ClientMessage[]> {
  return readCachedMessagesBefore(target, conversationId, beforeSeq, limit)
}

export function readSyncStateLocal(
  target: AuthenticatedTarget,
  conversationId: string
): Promise<MessageSyncState | null> {
  return getMessageSyncState(target, conversationId)
}

export function fetchLatestRemote(
  target: AuthenticatedTarget,
  conversationId: string,
  limit: number,
  options: { signal?: AbortSignal } = {}
): Promise<ClientMessageList> {
  return fetchConversationMessages(
    target,
    conversationId,
    { limit },
    options
  )
}

export function fetchBeforeRemote(
  target: AuthenticatedTarget,
  conversationId: string,
  beforeSeq: number,
  limit: number,
  options: { signal?: AbortSignal } = {}
): Promise<ClientMessageList> {
  return fetchConversationMessages(
    target,
    conversationId,
    { beforeSeq, limit },
    options
  )
}

export function fetchAfterRemote(
  target: AuthenticatedTarget,
  conversationId: string,
  afterSeq: number,
  limit: number,
  options: { signal?: AbortSignal } = {}
): Promise<ClientMessageList> {
  return fetchConversationMessages(
    target,
    conversationId,
    { afterSeq, limit },
    options
  )
}

export function persistLatest(
  target: AuthenticatedTarget,
  conversationId: string,
  result: ClientMessageList
): Promise<void> {
  return persistLatestHttpPage(target, conversationId, result)
}

export function persistBefore(
  target: AuthenticatedTarget,
  conversationId: string,
  requestedBeforeSeq: number,
  result: ClientMessageList
): Promise<void> {
  return persistBeforeHttpPage(target, conversationId, requestedBeforeSeq, result)
}

export function persistAfter(
  target: AuthenticatedTarget,
  conversationId: string,
  requestedAfterSeq: number,
  result: ClientMessageList
): Promise<number> {
  return persistAfterHttpPage(target, conversationId, requestedAfterSeq, result)
}

export function persistMessages(
  target: AuthenticatedTarget,
  messages: ClientMessage[]
): Promise<void> {
  return persistRealtimeMessages(target, messages)
}
