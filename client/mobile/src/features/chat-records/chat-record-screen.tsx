import * as Clipboard from "expo-clipboard"
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Alert, FlatList, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ContentState } from "@/components/feedback/content-state"
import { AppHeader } from "@/components/navigation/app-header"
import { openResourceExternally, useMessageResources } from "@/data/resources"
import {
  collectMessageResources,
  createMessageMentionLabelResolver,
  formatClientMessageBodySummary,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import { presentChatRecordMessages } from "@/features/chat-records/chat-record-model"
import { useChatRecordStore } from "@/features/chat-records/chat-record-provider"
import { MessageBubble } from "@/features/conversation/messages/message-bubble"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { buildAttachmentImagePreviewHref } from "@/navigation/image-preview"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { XGUIActionSheet, useXGUITheme, useXGUIToast } from "@/xgui"

const ignoreAction = () => {}

export function ChatRecordScreen() {
  const params = useLocalSearchParams<{ recordId: string }>()
  const recordId = Array.isArray(params.recordId) ? (params.recordId[0] ?? "") : (params.recordId ?? "")
  const router = useRouter()
  const store = useChatRecordStore()
  const record = store.get(recordId)
  const session = useAuthenticatedSession()
  const { contacts, currentUser } = useClientData()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const insets = useSafeAreaInsets()
  const focused = useIsFocused()
  const [copyTarget, setCopyTarget] = useState<PresentedMessage | null>(null)
  const [copySheetOpen, setCopySheetOpen] = useState(false)
  const resolveMentionLabel = useMemo(() => createMessageMentionLabelResolver({ contacts, currentUser: currentUser ?? undefined }), [contacts, currentUser])
  const items = useMemo(() => record ? presentChatRecordMessages(record, recordId) : [], [record, recordId])
  const references = useMemo(() => collectMessageResources(items.map((item) => item.message)), [items])
  const { ensure, reload, states } = useMessageResources(session, references)

  useEffect(() => store.retain(recordId), [recordId, store])
  useFocusEffect(useCallback(() => () => setCopySheetOpen(false), []))

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    else router.replace("/messages")
  }, [router])
  const openResource = useCallback(async (fileId: string) => {
    try {
      await openResourceExternally(await ensure(fileId))
    } catch (error: unknown) {
      Alert.alert("无法打开文件", error instanceof Error ? error.message : "文件下载失败，请重试。")
    }
  }, [ensure])
  const prepareVoice = useCallback(async (fileId: string) => {
    try {
      await ensure(fileId)
    } catch (error: unknown) {
      Alert.alert("无法播放语音", error instanceof Error ? error.message : "语音下载失败，请重试。")
    }
  }, [ensure])
  const openCopySheet = useCallback((message: PresentedMessage) => {
    setCopyTarget(message)
    setCopySheetOpen(true)
  }, [])
  const copyMessage = async () => {
    if (!copyTarget) return
    try {
      await Clipboard.setStringAsync(formatClientMessageBodySummary(copyTarget.body, resolveMentionLabel))
      toast.show({ message: "已复制", modal: false, type: "text", duration: 1_000 })
    } catch {
      toast.show({ message: "复制失败", modal: false, type: "text", duration: 1_000 })
    }
  }

  return (
    <View style={{ backgroundColor: colors.background0, flex: 1 }}>
      <AppHeader onBackPress={goBack} title="聊天记录" />
      {!record ? <ContentState message="聊天记录已失效，请返回后重新打开。" /> : (
        <FlatList
          contentContainerStyle={{ flexGrow: 1, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) }}
          data={items}
          initialNumToRender={12}
          ItemSeparatorComponent={MessageSeparator}
          keyExtractor={(item) => item.message.id}
          ListEmptyComponent={<ContentState message="暂无聊天记录" />}
          renderItem={({ item }) => (
            <MessageBubble
              avatarType={item.senderType}
              canAddReaction={false}
              canCreateTopic={false}
              canRespondToChoice={false}
              currentUserId={session.userId}
              message={item.message}
              messageActionsEnabled={false}
              onAvatarPress={ignoreAction}
              onImagePress={(fileId) => router.push(buildAttachmentImagePreviewHref(fileId))}
              onMentionPress={(target) => router.push(buildEntityDetailHref(target))}
              onMessageLongPress={openCopySheet}
              onOpenTopic={ignoreAction}
              onResourceError={(fileId) => void reload(fileId).catch(() => undefined)}
              onResourcePress={(fileId) => void openResource(fileId)}
              onVoiceResourcePress={(fileId) => void prepareVoice(fileId)}
              resolveMentionLabel={resolveMentionLabel}
              resourceStates={states}
              server={session}
              showChoiceResponseCounts={false}
            />
          )}
          style={{ flex: 1 }}
        />
      )}
      {copyTarget && record ? (
        <XGUIActionSheet
          actions={[{ label: "复制", deferUntilClosed: false, onPress: () => void copyMessage() }]}
          description={formatClientMessageBodySummary(copyTarget.body, resolveMentionLabel)}
          descriptionNumberOfLines={2}
          onAnimationComplete={(open) => { if (!open) setCopyTarget(null) }}
          onOpenChange={setCopySheetOpen}
          open={copySheetOpen && focused}
          title="消息操作"
        />
      ) : null}
    </View>
  )
}

function MessageSeparator() { return <View style={{ height: 20 }} /> }
