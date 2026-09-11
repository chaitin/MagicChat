import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react"
import { toast } from "sonner"

import {
  listConversationMessages,
  type ClientMessage,
  type ClientMessageList,
} from "@/lib/client-data-api"
import type { ClientConversationMessageState } from "@/lib/client-data-context"
import { ConversationMessageWindowCoordinator } from "@/lib/conversation-message-window-coordinator"
import {
  getClientDataErrorMessage,
  mergeLatestConversationMessageWindow,
  mergeConversationMessages,
  mergePageWithAfterResult,
  mergePageWithBeforeResult,
  messagePageLimit,
  reconcilePageWithPendingLatestMessages,
} from "@/lib/client-data-state"

type UpdateConversationMessageState = (
  conversationId: string,
  updater: (
    state: ClientConversationMessageState
  ) => ClientConversationMessageState
) => void

export function useConversationMessageWindow({
  conversationMessageStates,
  conversationMessageStatesRef,
  getConversationLatestSeq,
  rememberConversationMessage,
  updateConversationMessageState,
}: {
  conversationMessageStates: Record<string, ClientConversationMessageState>
  conversationMessageStatesRef: RefObject<
    Record<string, ClientConversationMessageState>
  >
  getConversationLatestSeq: (conversationId: string) => number
  rememberConversationMessage: (message: ClientMessage) => void
  updateConversationMessageState: UpdateConversationMessageState
}) {
  const focusRequestKeyRef = useRef(0)
  const coordinator = useMemo(
    () => new ConversationMessageWindowCoordinator(),
    []
  )

  useEffect(() => {
    coordinator.synchronizeDesiredModes(conversationMessageStates)
  }, [conversationMessageStates, coordinator])

  const invalidateConversationMessageRequests = useCallback(() => {
    coordinator.invalidateAllRequests()
  }, [coordinator])

  const ensureConversationMessages = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        return
      }

      const state = conversationMessageStatesRef.current[conversationId]
      if (
        coordinator.getDesiredMode(conversationId) === "history" ||
        state?.viewMode === "history" ||
        state?.loaded ||
        state?.loading
      ) {
        return
      }
      const requestToken = coordinator.tryBeginRequest(
        "initial",
        conversationId
      )
      if (!requestToken) {
        return
      }

      const version = coordinator.getRequestVersion(conversationId)
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        loading: true,
      }))

      void listConversationMessages(conversationId, {
        limit: messagePageLimit,
      })
        .then((result) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          updateConversationMessageState(conversationId, (currentState) => {
            const { messages, page } = mergeLatestConversationMessageWindow(
              currentState.messages,
              result.messages,
              result.page
            )
            return {
              ...currentState,
              error: null,
              loaded: true,
              loading: false,
              latestKnownSeq: Math.max(
                currentState.latestKnownSeq,
                result.page.newestSeq,
                getConversationLatestSeq(conversationId)
              ),
              messages,
              page,
            }
          })
          const latestMessage = result.messages.at(-1)
          if (latestMessage) rememberConversationMessage(latestMessage)
        })
        .catch((error: unknown) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          const message = getClientDataErrorMessage(error, "加载消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loaded: false,
            loading: false,
          }))
          toast.error(message)
        })
        .finally(() => {
          coordinator.finishRequest("initial", conversationId, requestToken)
        })
    },
    [
      conversationMessageStatesRef,
      getConversationLatestSeq,
      coordinator,
      rememberConversationMessage,
      updateConversationMessageState,
    ]
  )

  const loadBeforeConversationMessages = useCallback(
    (conversationId: string) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (!state?.page?.hasMoreBefore || !state.loaded || state.loadingBefore) {
        return
      }
      const requestToken = coordinator.tryBeginRequest("before", conversationId)
      if (!requestToken) {
        return
      }

      const version = coordinator.getRequestVersion(conversationId)
      const beforeSeq = state.page.oldestSeq
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        loadingBefore: true,
      }))

      void listConversationMessages(conversationId, {
        beforeSeq,
        limit: messagePageLimit,
      })
        .then((result) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          updateConversationMessageState(conversationId, (currentState) => {
            const messages = mergeConversationMessages(
              currentState.messages,
              result.messages
            )
            return {
              ...currentState,
              error: null,
              loaded: true,
              loadingBefore: false,
              messages,
              page: mergePageWithBeforeResult(
                currentState.page,
                result.page,
                messages
              ),
            }
          })
        })
        .catch((error: unknown) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          const message = getClientDataErrorMessage(error, "加载更早消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loadingBefore: false,
          }))
          toast.error(message)
        })
        .finally(() => {
          coordinator.finishRequest("before", conversationId, requestToken)
        })
    },
    [conversationMessageStatesRef, coordinator, updateConversationMessageState]
  )

  const loadAfterConversationMessages = useCallback(
    (conversationId: string) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (
        state?.viewMode !== "history" ||
        !state.page?.hasMoreAfter ||
        !state.loaded ||
        state.loadingAfter
      ) {
        return
      }
      const requestToken = coordinator.tryBeginRequest("after", conversationId)
      if (!requestToken) {
        return
      }

      const version = coordinator.getRequestVersion(conversationId)
      const afterSeq = state.page.newestSeq
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        loadingAfter: true,
      }))

      void listConversationMessages(conversationId, {
        afterSeq,
        limit: messagePageLimit,
      })
        .then((result) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          updateConversationMessageState(conversationId, (currentState) => {
            const messages = mergeConversationMessages(
              currentState.messages,
              result.messages
            )
            const mergedPage = mergePageWithAfterResult(
              currentState.page,
              result.page,
              messages
            )
            const latestKnownSeq = Math.max(
              currentState.latestKnownSeq,
              mergedPage.newestSeq,
              getConversationLatestSeq(conversationId)
            )
            const page = reconcilePageWithPendingLatestMessages(
              mergedPage,
              latestKnownSeq,
              currentState.pendingLatestMessageCount
            )
            const reachedLatest = !page.hasMoreAfter
            coordinator.setDesiredMode(
              conversationId,
              reachedLatest ? "latest" : "history"
            )
            return {
              ...currentState,
              error: null,
              focus: reachedLatest ? null : currentState.focus,
              loaded: true,
              loadingAfter: false,
              latestKnownSeq,
              messages,
              page,
              pendingLatestMessageCount: reachedLatest
                ? 0
                : currentState.pendingLatestMessageCount,
              viewMode: reachedLatest ? "latest" : "history",
            }
          })
        })
        .catch((error: unknown) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          const message = getClientDataErrorMessage(error, "加载更新消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loadingAfter: false,
          }))
          toast.error(message)
        })
        .finally(() => {
          coordinator.finishRequest("after", conversationId, requestToken)
        })
    },
    [
      conversationMessageStatesRef,
      coordinator,
      getConversationLatestSeq,
      updateConversationMessageState,
    ]
  )

  const replaceWithLatestMessages = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        return
      }
      const version = coordinator.beginWindowRequest(conversationId, "latest")
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        focus: null,
        loaded: false,
        loading: true,
        loadingAfter: false,
        loadingBefore: false,
        messages: [],
        page: null,
        pendingLatestMessageCount: 0,
        viewMode: "latest",
      }))

      void listConversationMessages(conversationId, {
        limit: messagePageLimit,
      })
        .then((result) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          updateConversationMessageState(conversationId, (currentState) => {
            const { messages, page } = mergeLatestConversationMessageWindow(
              currentState.messages,
              result.messages,
              result.page
            )
            return {
              ...currentState,
              error: null,
              loaded: true,
              loading: false,
              latestKnownSeq: Math.max(
                currentState.latestKnownSeq,
                result.page.newestSeq,
                messages.at(-1)?.seq ?? 0,
                getConversationLatestSeq(conversationId)
              ),
              messages,
              page,
              pendingLatestMessageCount: 0,
            }
          })
          const latestMessage = result.messages.at(-1)
          if (latestMessage) rememberConversationMessage(latestMessage)
        })
        .catch((error: unknown) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          const message = getClientDataErrorMessage(error, "加载最新消息失败")
          updateConversationMessageState(conversationId, (currentState) => ({
            ...currentState,
            error: message,
            loaded: false,
            loading: false,
          }))
          toast.error(message)
        })
    },
    [
      coordinator,
      getConversationLatestSeq,
      rememberConversationMessage,
      updateConversationMessageState,
    ]
  )

  const focusConversationMessage = useCallback(
    async (
      conversationId: string,
      target: { messageId: string; seq: number }
    ) => {
      if (!conversationId || !target.messageId || target.seq < 1) {
        return
      }

      const version = coordinator.beginWindowRequest(conversationId, "history")
      const requestKey = ++focusRequestKeyRef.current
      updateConversationMessageState(conversationId, (currentState) => ({
        ...currentState,
        error: null,
        focus: { messageId: target.messageId, requestKey },
        loaded: false,
        loading: true,
        loadingAfter: false,
        loadingBefore: false,
        latestKnownSeq: Math.max(
          currentState.latestKnownSeq,
          target.seq,
          getConversationLatestSeq(conversationId)
        ),
        messages: [],
        page: null,
        pendingLatestMessageCount: 0,
        viewMode: "history",
      }))

      try {
        const [before, after] = await Promise.all([
          listConversationMessages(conversationId, {
            beforeSeq: target.seq + 1,
            limit: messagePageLimit,
          }),
          listConversationMessages(conversationId, {
            afterSeq: target.seq,
            limit: messagePageLimit,
          }),
        ])
        if (!coordinator.requestIsCurrent(conversationId, version)) {
          return
        }
        const messages = mergeConversationMessages(
          before.messages,
          after.messages
        )
        if (!messages.some((message) => message.id === target.messageId)) {
          throw new Error("target message is no longer available")
        }
        const resultPage = createFocusedMessagePage(before, after, messages)
        updateConversationMessageState(conversationId, (currentState) => {
          const latestKnownSeq = Math.max(
            currentState.latestKnownSeq,
            resultPage.newestSeq,
            getConversationLatestSeq(conversationId)
          )
          const page = reconcilePageWithPendingLatestMessages(
            resultPage,
            latestKnownSeq,
            currentState.pendingLatestMessageCount
          )
          const reachedLatest = !page.hasMoreAfter
          coordinator.setDesiredMode(
            conversationId,
            reachedLatest ? "latest" : "history"
          )
          return {
            ...currentState,
            error: null,
            loaded: true,
            loading: false,
            latestKnownSeq,
            messages,
            page,
            pendingLatestMessageCount: reachedLatest
              ? 0
              : currentState.pendingLatestMessageCount,
            viewMode: reachedLatest ? "latest" : "history",
          }
        })
      } catch (error: unknown) {
        if (!coordinator.requestIsCurrent(conversationId, version)) {
          return
        }
        const message = getClientDataErrorMessage(
          error,
          "无法定位消息，消息可能已被删除或不可见"
        )
        toast.error(message)
        replaceWithLatestMessages(conversationId)
      }
    },
    [
      coordinator,
      getConversationLatestSeq,
      replaceWithLatestMessages,
      updateConversationMessageState,
    ]
  )

  const returnToLatestConversationMessages = useCallback(
    (conversationId: string) => replaceWithLatestMessages(conversationId),
    [replaceWithLatestMessages]
  )

  const syncAfterConversationMessages = useCallback(
    (conversationId: string, afterSeq: number) => {
      const state = conversationMessageStatesRef.current[conversationId]
      if (
        coordinator.getDesiredMode(conversationId) === "history" ||
        state?.viewMode === "history"
      ) {
        return
      }
      const requestToken = coordinator.tryBeginRequest("sync", conversationId)
      if (!requestToken) {
        return
      }
      const version = coordinator.getRequestVersion(conversationId)

      void listConversationMessages(conversationId, {
        afterSeq,
        limit: messagePageLimit,
      })
        .then((result) => {
          if (!coordinator.requestIsCurrent(conversationId, version)) {
            return
          }
          const lastReceivedMessage = result.messages.at(-1)
          updateConversationMessageState(conversationId, (currentState) => {
            const messages = mergeConversationMessages(
              currentState.messages,
              result.messages
            )
            return {
              ...currentState,
              error: null,
              latestKnownSeq: Math.max(
                currentState.latestKnownSeq,
                result.page.newestSeq
              ),
              messages,
              page: mergePageWithAfterResult(
                currentState.page,
                result.page,
                messages
              ),
            }
          })
          if (lastReceivedMessage) {
            rememberConversationMessage(lastReceivedMessage)
          }
        })
        .catch((error: unknown) => {
          if (coordinator.requestIsCurrent(conversationId, version)) {
            toast.error(getClientDataErrorMessage(error, "同步新消息失败"))
          }
        })
        .finally(() => {
          coordinator.finishRequest("sync", conversationId, requestToken)
        })
    },
    [
      conversationMessageStatesRef,
      coordinator,
      rememberConversationMessage,
      updateConversationMessageState,
    ]
  )

  return {
    ensureConversationMessages,
    invalidateConversationMessageRequests,
    focusConversationMessage,
    loadAfterConversationMessages,
    loadBeforeConversationMessages,
    returnToLatestConversationMessages,
    syncAfterConversationMessages,
  }
}

function createFocusedMessagePage(
  before: ClientMessageList,
  after: ClientMessageList,
  messages: ClientMessage[]
) {
  return {
    hasMoreAfter: after.page.hasMoreAfter,
    hasMoreBefore: before.page.hasMoreBefore,
    limit: messagePageLimit,
    newestSeq: messages.at(-1)?.seq ?? 0,
    oldestSeq: messages[0]?.seq ?? 0,
  }
}
