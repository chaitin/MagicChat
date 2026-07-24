import { useRouter } from "expo-router"
import { useMemo, useRef, useState } from "react"
import { useToastController } from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  useDismissConversation,
  useSetConversationMuted,
  useSetConversationPinned,
} from "@/data/conversation-hooks"
import type { ClientConversation } from "@/data/models"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import {
  ConversationActionSheet,
  type ConversationAction,
} from "@/features/messages/conversation-action-sheet"
import { ConversationList } from "@/features/messages/conversation-list"
import {
  buildConversationListItems,
  type ConversationListItemModel,
} from "@/features/messages/conversation-list-model"
import { DismissConversationDialog } from "@/features/messages/dismiss-conversation-dialog"
import { useClientData } from "@/providers/client-data-provider"
import { buildConversationHref } from "@/navigation/conversations"

export function MessagesScreen() {
  const router = useRouter()
  const toast = useToastController()
  const session = useAuthenticatedSession()
  const pinMutation = useSetConversationPinned(session)
  const muteMutation = useSetConversationMuted(session)
  const dismissMutation = useDismissConversation(session)
  const pendingDismissCandidateRef = useRef<ClientConversation | null>(null)
  const [actionItem, setActionItem] =
    useState<ConversationListItemModel | null>(null)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [dismissCandidate, setDismissCandidate] =
    useState<ClientConversation | null>(null)
  const {
    contacts,
    conversations,
    conversationsError,
    isConversationsRefreshing,
    refreshConversations,
  } = useClientData()
  const items = useMemo(
    () =>
      buildConversationListItems({
        contacts,
        conversations,
        keyword: "",
      }),
    [contacts, conversations]
  )

  function handleRefresh() {
    void refreshConversations().catch(() => undefined)
  }

  function handleConversationPress(conversationId: string) {
    router.push(buildConversationHref(conversationId))
  }

  function handleConversationLongPress(item: ConversationListItemModel) {
    pendingDismissCandidateRef.current = null
    setActionItem(item)
    setActionSheetOpen(true)
  }

  function handleActionSheetAnimationComplete(open: boolean) {
    if (open) return

    setActionItem(null)
    const pendingDismissCandidate = pendingDismissCandidateRef.current
    pendingDismissCandidateRef.current = null
    if (pendingDismissCandidate) {
      setDismissCandidate(pendingDismissCandidate)
    }
  }

  async function handlePinnedChange(pinned: boolean) {
    if (!actionItem || pinMutation.isPending || muteMutation.isPending) return

    try {
      await pinMutation.mutateAsync({
        conversationId: actionItem.conversation.id,
        pinned,
      })
      showSuccessToast(toast, pinned ? "会话已置顶" : "已取消置顶")
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        pinned ? "置顶会话失败" : "取消置顶失败",
        error
      )
    }
  }

  async function handleMutedChange(muted: boolean) {
    if (!actionItem || pinMutation.isPending || muteMutation.isPending) return

    try {
      await muteMutation.mutateAsync({
        conversationId: actionItem.conversation.id,
        muted,
      })
      showSuccessToast(
        toast,
        muted ? "已开启消息免打扰" : "已取消消息免打扰"
      )
      setActionSheetOpen(false)
    } catch (error: unknown) {
      showErrorToast(
        toast,
        muted ? "开启消息免打扰失败" : "取消消息免打扰失败",
        error
      )
    }
  }

  function handleRequestDismiss() {
    if (!actionItem || pinMutation.isPending || muteMutation.isPending) return

    pendingDismissCandidateRef.current = actionItem.conversation
    setActionSheetOpen(false)
  }

  async function handleDismissConversation() {
    if (!dismissCandidate || dismissMutation.isPending) return

    try {
      await dismissMutation.mutateAsync(dismissCandidate.id)
      setDismissCandidate(null)
      showSuccessToast(toast, "对话已删除")
    } catch (error: unknown) {
      showErrorToast(toast, "删除对话失败", error)
    }
  }

  const activeAction: ConversationAction = pinMutation.isPending
    ? "pin"
    : muteMutation.isPending
      ? "mute"
      : null

  return (
    <>
      <KeyboardAwareScreen
        contentBackground="$color1"
        edges={[]}
        scrollable={false}
      >
        <ConversationList
          errorMessage={conversationsError?.message}
          hasKeyword={false}
          isRefreshing={isConversationsRefreshing}
          items={items}
          onConversationLongPress={handleConversationLongPress}
          onConversationPress={handleConversationPress}
          onRefresh={handleRefresh}
          server={session}
        />
      </KeyboardAwareScreen>

      <ConversationActionSheet
        activeAction={activeAction}
        item={actionItem}
        onAnimationComplete={handleActionSheetAnimationComplete}
        onDelete={handleRequestDismiss}
        onMutedChange={(muted) => void handleMutedChange(muted)}
        onOpenChange={setActionSheetOpen}
        onPinnedChange={(pinned) => void handlePinnedChange(pinned)}
        open={actionSheetOpen}
        server={session}
      />

      <DismissConversationDialog
        conversationName={dismissCandidate?.name ?? ""}
        deleting={dismissMutation.isPending}
        onConfirm={() => void handleDismissConversation()}
        onOpenChange={(open) => {
          if (!open) setDismissCandidate(null)
        }}
        open={dismissCandidate !== null}
      />
    </>
  )
}

function showSuccessToast(
  toast: ReturnType<typeof useToastController>,
  title: string
) {
  toast.show(title, {
    customData: { tone: "success" satisfies AppToastTone },
  })
}

function showErrorToast(
  toast: ReturnType<typeof useToastController>,
  title: string,
  error: unknown
) {
  toast.show(title, {
    customData: { tone: "error" satisfies AppToastTone },
    duration: 4000,
    message: error instanceof Error ? error.message : title,
  })
}
