import { useLocalSearchParams, useRouter } from "expo-router"
import { Text, View } from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import { useAddGroupConversationMembers } from "@/data/conversations/conversation-hooks"
import { ContactMultiSelectScreen } from "@/features/conversation-details/contact-multi-select-screen"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { useXGUITheme, useXGUIToast } from "@/xgui"

export function AddGroupMembersScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[]
  }>()
  const conversationId = firstParam(params.conversationId)
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { conversations, isReady } = useClientData()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const addMutation = useAddGroupConversationMembers(session)
  const conversation = conversations.find(
    (item) => item.id === conversationId && item.type === "group"
  )
  const existingUserIds = (conversation?.members ?? []).flatMap((member) =>
    member.type === "user" ? [member.id] : []
  )

  async function addMembers(userIds: string[]) {
    if (addMutation.isPending || userIds.length === 0) return

    toast.show({ duration: 0, message: "正在添加成员…", type: "loading" })
    try {
      await addMutation.mutateAsync({ conversationId, memberIds: userIds })
      toast.hide()
      router.back()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "添加群成员失败，请稍后重试"
      toast.show({ message, modal: false, type: "error" })
    }
  }

  if (!conversation) {
    return (
      <View style={{ backgroundColor: colors.background0, flex: 1 }}>
        <AppHeader onBackPress={() => router.back()} title="添加成员" />
        <View
          style={{
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: colors.textSecondary }}>
            {isReady ? "群聊不存在或已不可用" : "正在加载群聊…"}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <ContactMultiSelectScreen
      excludedUserIds={existingUserIds}
      onCancel={() => router.back()}
      onComplete={(userIds) => void addMembers(userIds)}
      submitting={addMutation.isPending}
      title="添加成员"
    />
  )
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
