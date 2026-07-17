import { useRouter } from "expo-router"
import { useMemo } from "react"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import { ConversationList } from "@/features/messages/conversation-list"
import { buildConversationListItems } from "@/features/messages/conversation-list-model"
import { useClientData } from "@/providers/client-data-provider"
import { buildConversationHref } from "@/navigation/conversations"

export function MessagesScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
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

  return (
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
        onConversationPress={handleConversationPress}
        onRefresh={handleRefresh}
        server={session}
      />
    </KeyboardAwareScreen>
  )
}
