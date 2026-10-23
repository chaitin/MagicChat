import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router"
import { useCallback, useMemo, useState } from "react"
import { BackHandler, FlatList, Keyboard, View } from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { orderConversations } from "@/domain/conversations/conversation-order"
import {
  HalfScreenSearchInput,
  HalfScreenSelectionRow,
} from "@/features/conversation/half-screen-selection-controls"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import {
  parseSendTargetRequest,
  sendTargetScope,
  toggleSendTarget,
  type SendTargetRequest,
} from "@/navigation/send-target"
import { useAuth, useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { XGUIButton, useXGUITheme } from "@/xgui"
import { useSendToConversations } from "./use-send-to-conversations"

export function SendToScreen() {
  const params = useLocalSearchParams()
  const session = useAuthenticatedSession()
  const { generation } = useAuth()
  const router = useRouter()
  const scope = sendTargetScope(session, generation)
  const request = parseSendTargetRequest(params, scope)

  function goBack() {
    Keyboard.dismiss()
    if (router.canGoBack()) router.back()
    else router.replace("/messages")
  }

  if (!request) {
    return (
      <KeyboardAwareScreen edges={["bottom"]} scrollable={false}>
        <AppHeader
          onBackPress={goBack}
          title={params.purpose === "namecard" ? "发送名片" : "转发消息"}
        />
        <ContentState message="发送请求已失效，请返回后重新选择" />
      </KeyboardAwareScreen>
    )
  }

  return (
    <SendToContent
      key={`${scope}:${JSON.stringify(request)}`}
      request={request}
      onBack={goBack}
    />
  )
}

function SendToContent({ request, onBack }: {
  request: SendTargetRequest
  onBack: () => void
}) {
  const session = useAuthenticatedSession()
  const { conversations } = useClientData()
  const { colors } = useXGUITheme()
  const [keyword, setKeyword] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const { submitting, send } = useSendToConversations(request, onBack)

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => submitting)
    return () => subscription.remove()
  }, [submitting]))

  const available = useMemo(() => orderConversations(
    conversations.filter((item) => !item.topic?.archived && item.canSend !== false)
  ), [conversations])
  const visible = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase()
    return available.filter((item) => !normalized || item.name.toLocaleLowerCase().includes(normalized))
  }, [available, keyword])
  const selectedIds = available.filter((item) => selected.has(item.id)).map((item) => item.id)

  return (
    <KeyboardAwareScreen
      edges={["bottom"]}
      scrollable={false}
      contentBackground={colors.background2}
    >
      <Stack.Screen options={{ gestureEnabled: !submitting }} />
      <AppHeader
        onBackPress={() => { if (!submitting) onBack() }}
        title={request.purpose === "namecard" ? "发送名片" : "转发消息"}
        headerAction={
          <XGUIButton
            accessibilityLabel="发送"
            disabled={selectedIds.length === 0 || submitting}
            loading={submitting}
            size="mini"
            onPress={() => { Keyboard.dismiss(); void send(selectedIds) }}
            style={{ height: 32, minWidth: 64 }}
            textStyle={{ fontSize: 15, lineHeight: 20 }}
          >
            {selectedIds.length > 0 ? `发送(${selectedIds.length})` : "发送"}
          </XGUIButton>
        }
      />
      <View style={{ backgroundColor: colors.background0, paddingTop: 10 }}>
        <HalfScreenSearchInput
          onChangeText={setKeyword}
          placeholder="搜索会话"
          value={keyword}
        />
      </View>
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 20, flexGrow: visible.length === 0 ? 1 : undefined }}
        data={visible}
        extraData={{ selected, submitting }}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <ContentState message={keyword.trim() ? "没有匹配的会话" : "暂无可发送的会话"} />
        }
        renderItem={({ item }) => (
          <HalfScreenSelectionRow
            accessibilityLabel={`${selected.has(item.id) ? "取消选择" : "选择"}会话 ${item.name}`}
            checkbox
            checkboxPosition="end"
            leading={<ConversationAvatar conversation={item} server={session} size={32} />}
            onPress={() => {
              if (!submitting) setSelected((current) => toggleSendTarget(current, item.id, request.purpose))
            }}
            selected={selected.has(item.id)}
            title={item.name}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
    </KeyboardAwareScreen>
  )
}
