import { useLocalSearchParams, useRouter } from "expo-router"

import { useCreateGroupConversation } from "@/data/conversations/conversation-hooks"
import { ContactMultiSelectScreen } from "@/features/conversation-details/contact-multi-select-screen"
import { buildConversationHref } from "@/navigation/conversations"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useXGUIToast } from "@/xgui"

export function CreateGroupConversationScreen() {
  const params = useLocalSearchParams<{
    initialUserIds?: string | string[]
  }>()
  const initialUserIds = firstParam(params.initialUserIds)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  const router = useRouter()
  const session = useAuthenticatedSession()
  const toast = useXGUIToast()
  const createMutation = useCreateGroupConversation(session)

  async function createGroup(userIds: string[]) {
    if (createMutation.isPending || userIds.length === 0) return

    toast.show({ duration: 0, message: "正在创建群聊…", type: "loading" })
    try {
      const conversation = await createMutation.mutateAsync(userIds)
      toast.hide()
      router.replace(buildConversationHref(conversation.id))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "创建群聊失败，请稍后重试"
      toast.show({ message, modal: false, type: "error" })
    }
  }

  return (
    <ContactMultiSelectScreen
      initialSelectedUserIds={initialUserIds}
      onCancel={() => router.back()}
      onComplete={(userIds) => void createGroup(userIds)}
      submitting={createMutation.isPending}
      title="选择联系人"
    />
  )
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
