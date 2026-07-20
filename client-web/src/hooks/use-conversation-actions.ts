import { useCallback, type Dispatch, type SetStateAction } from "react"
import type { NavigateFunction } from "react-router"

import {
  addGroupConversationMembers as addGroupConversationMembersRequest,
  type ClientConversation,
  ClientDataRequestError,
  createDirectConversation,
  createGroupConversation as createGroupConversationRequest,
  dissolveGroupConversation as dissolveGroupConversationRequest,
  type GroupConversationActionResult,
  joinGroupConversation as joinGroupConversationRequest,
  leaveGroupConversation as leaveGroupConversationRequest,
  openAppConversation as openAppConversationRequest,
  removeGroupConversationMember as removeGroupConversationMemberRequest,
  revokeConversationMessage as revokeConversationMessageRequest,
  setGroupConversationPrivate as setGroupConversationPrivateRequest,
  setGroupConversationPublic as setGroupConversationPublicRequest,
  updateGroupConversationName as updateGroupConversationNameRequest,
  uploadGroupConversationAvatar as uploadGroupConversationAvatarRequest,
} from "@/lib/client-data-api"
import type {
  ClientConversationMessageState,
  ClientDataContextValue,
} from "@/lib/client-data-context"
import {
  emptyConversationMessageState,
  orderConversations,
} from "@/lib/client-data-state"

export function useConversationActions({
  conversations,
  conversationMessageStates,
  handleError,
  mergeIncomingConversationMessage,
  navigate,
  refreshContacts,
  setConversationMessageStates,
  setConversations,
}: {
  conversations: ClientConversation[]
  conversationMessageStates: Record<string, ClientConversationMessageState>
  handleError: (
    error: unknown,
    fallbackMessage: string
  ) => ClientDataRequestError
  mergeIncomingConversationMessage: ClientDataContextValue["mergeIncomingConversationMessage"]
  navigate: NavigateFunction
  refreshContacts: ClientDataContextValue["refreshContacts"]
  setConversationMessageStates: Dispatch<
    SetStateAction<Record<string, ClientConversationMessageState>>
  >
  setConversations: Dispatch<SetStateAction<ClientConversation[]>>
}) {
  const getConversationMessageState = useCallback(
    (conversationId: string) => {
      return (
        conversationMessageStates[conversationId] ??
        emptyConversationMessageState
      )
    },
    [conversationMessageStates]
  )

  const getConversation = useCallback(
    (conversationId: string) => {
      return (
        conversations.find(
          (conversation) => conversation.id === conversationId
        ) ?? null
      )
    },
    [conversations]
  )

  const upsertConversation = useCallback(
    (conversation: ClientConversation) => {
      setConversations((currentConversations) => {
        const currentConversation = currentConversations.find(
          (item) => item.id === conversation.id
        )
        const nextConversation =
          conversation.projects === undefined && currentConversation?.projects
            ? { ...conversation, projects: currentConversation.projects }
            : conversation

        return orderConversations([
          nextConversation,
          ...currentConversations.filter((item) => item.id !== conversation.id),
        ])
      })
    },
    [setConversations]
  )

  const removeConversation = useCallback(
    (conversationId: string) => {
      setConversations((currentConversations) =>
        currentConversations.filter(
          (conversation) => conversation.id !== conversationId
        )
      )
      setConversationMessageStates((currentStates) => {
        const nextStates = { ...currentStates }
        delete nextStates[conversationId]

        return nextStates
      })
    },
    [setConversationMessageStates, setConversations]
  )

  const openDirectConversation = useCallback(
    async (userId: string) => {
      try {
        const conversation = await createDirectConversation(userId)
        upsertConversation(conversation)
        return conversation
      } catch (error) {
        throw handleError(error, "创建一对一会话失败")
      }
    },
    [handleError, upsertConversation]
  )

  const openAppConversation = useCallback(
    async (appId: string) => {
      try {
        const conversation = await openAppConversationRequest(appId)
        upsertConversation(conversation)
        return conversation
      } catch (error) {
        throw handleError(error, "创建应用会话失败")
      }
    },
    [handleError, upsertConversation]
  )

  const createGroupConversation = useCallback(
    async (name: string, memberIds: string[], appIds: string[] = []) => {
      try {
        const conversation = await createGroupConversationRequest({
          appIds,
          memberIds,
          name,
        })
        upsertConversation(conversation)
        return conversation
      } catch (error) {
        throw handleError(error, "创建群聊失败")
      }
    },
    [handleError, upsertConversation]
  )

  const addGroupConversationMembers = useCallback(
    async (
      conversationId: string,
      memberIds: string[],
      appIds: string[] = []
    ) => {
      try {
        const result = await addGroupConversationMembersRequest(
          conversationId,
          {
            appIds,
            memberIds,
          }
        )
        upsertConversation(result.conversation)
        if (result.message) {
          mergeIncomingConversationMessage(result.message, { markLoaded: true })
        }
        return result.conversation
      } catch (error) {
        throw handleError(error, "添加群聊成员失败")
      }
    },
    [handleError, mergeIncomingConversationMessage, upsertConversation]
  )

  const applyGroupConversationAction = useCallback(
    async (
      action: () => Promise<GroupConversationActionResult>,
      fallbackMessage: string
    ) => {
      try {
        const result = await action()
        upsertConversation(result.conversation)
        if (result.message) {
          mergeIncomingConversationMessage(result.message, {
            markLoaded: true,
            updateList: false,
          })
        }
        await refreshContacts()
        return result.conversation
      } catch (error) {
        throw handleError(error, fallbackMessage)
      }
    },
    [
      handleError,
      mergeIncomingConversationMessage,
      refreshContacts,
      upsertConversation,
    ]
  )

  const joinGroupConversation = useCallback(
    async (conversationId: string) =>
      applyGroupConversationAction(
        () => joinGroupConversationRequest(conversationId),
        "加入群聊失败"
      ),
    [applyGroupConversationAction]
  )

  const setGroupConversationPublic = useCallback(
    async (conversationId: string) =>
      applyGroupConversationAction(
        () => setGroupConversationPublicRequest(conversationId),
        "设置公开群失败"
      ),
    [applyGroupConversationAction]
  )

  const setGroupConversationPrivate = useCallback(
    async (conversationId: string) =>
      applyGroupConversationAction(
        () => setGroupConversationPrivateRequest(conversationId),
        "取消公开群失败"
      ),
    [applyGroupConversationAction]
  )

  const updateGroupConversationName = useCallback(
    async (conversationId: string, name: string) =>
      applyGroupConversationAction(
        () => updateGroupConversationNameRequest(conversationId, { name }),
        "修改群聊名称失败"
      ),
    [applyGroupConversationAction]
  )

  const leaveGroupConversation = useCallback(
    async (conversationId: string) => {
      try {
        await leaveGroupConversationRequest(conversationId)
        removeConversation(conversationId)
        navigate("/chat", { replace: true })
        void refreshContacts().catch(() => undefined)
      } catch (error) {
        throw handleError(error, "退出群聊失败")
      }
    },
    [handleError, navigate, refreshContacts, removeConversation]
  )

  const dissolveGroupConversation = useCallback(
    async (conversationId: string) => {
      try {
        await dissolveGroupConversationRequest(conversationId)
        removeConversation(conversationId)
        navigate("/chat", { replace: true })
        void refreshContacts().catch(() => undefined)
      } catch (error) {
        throw handleError(error, "解散群聊失败")
      }
    },
    [handleError, navigate, refreshContacts, removeConversation]
  )

  const removeGroupConversationMember = useCallback(
    async (
      conversationId: string,
      memberId: string,
      memberType: "user" | "app" = "user"
    ) =>
      applyGroupConversationAction(
        () =>
          removeGroupConversationMemberRequest(
            conversationId,
            memberId,
            memberType
          ),
        "移出群聊成员失败"
      ),
    [applyGroupConversationAction]
  )

  const updateGroupConversationAvatar = useCallback(
    async (conversationId: string, file: File) => {
      try {
        const result = await uploadGroupConversationAvatarRequest(
          conversationId,
          file
        )
        upsertConversation(result.conversation)
        mergeIncomingConversationMessage(result.message, { markLoaded: true })
        return result.conversation
      } catch (error) {
        throw handleError(error, "上传群头像失败")
      }
    },
    [handleError, mergeIncomingConversationMessage, upsertConversation]
  )

  const revokeConversationMessage = useCallback(
    async (conversationId: string, messageId: string) => {
      try {
        const result = await revokeConversationMessageRequest(
          conversationId,
          messageId
        )
        mergeIncomingConversationMessage(result.message, {
          markLoaded: true,
          updateList: false,
        })
        mergeIncomingConversationMessage(result.systemMessage, {
          markLoaded: true,
        })
      } catch (error) {
        throw handleError(error, "撤回消息失败")
      }
    },
    [handleError, mergeIncomingConversationMessage]
  )

  return {
    addGroupConversationMembers,
    createGroupConversation,
    dissolveGroupConversation,
    getConversation,
    getConversationMessageState,
    joinGroupConversation,
    leaveGroupConversation,
    openAppConversation,
    openDirectConversation,
    removeConversation,
    removeGroupConversationMember,
    revokeConversationMessage,
    setGroupConversationPrivate,
    setGroupConversationPublic,
    updateGroupConversationAvatar,
    updateGroupConversationName,
  }
}
