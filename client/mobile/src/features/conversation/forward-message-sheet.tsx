import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { useCallback, useMemo, useState } from "react"
import { FlatList, Keyboard, StyleSheet, Text, View } from "react-native"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ClientConversation } from "@/core/models"
import type { ServerTarget } from "@/core/server-target"
import { orderConversations } from "@/domain/conversations/conversation-order"
import { formatMessageTimeMarker } from "@/domain/messages/message-presenter"
import {
  HalfScreenSearchInput,
  HalfScreenSelectionRow,
} from "@/features/conversation/half-screen-selection-controls"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import {
  XGUIButton,
  XGUIHalfScreenDialog,
  useXGUITheme,
} from "@/xgui"

export function ForwardMessageSheet({
  conversations,
  onAnimationComplete,
  onForward,
  onRequestClose,
  open,
  server,
  source,
}: {
  conversations: ClientConversation[]
  onAnimationComplete: (open: boolean) => void
  onForward: (targetConversationIds: string[]) => Promise<boolean>
  onRequestClose: () => void
  open: boolean
  server: ServerTarget
  source: ForwardMessageSource | null
}) {
  const queryClient = useQueryClient()
  const { colors } = useXGUITheme()
  const [keyword, setKeyword] = useState("")
  const [selectedConversationIds, setSelectedConversationIds] = useState(
    () => new Set<string>()
  )
  const [submitting, setSubmitting] = useState(false)
  const visibleConversations = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase()
    return orderConversations(
      conversations.filter((conversation) => !conversation.topic?.archived)
    ).filter(
      (conversation) =>
        !normalizedKeyword ||
        conversation.name.toLocaleLowerCase().includes(normalizedKeyword)
    )
  }, [conversations, keyword])

  function resetForm() {
    setKeyword("")
    setSelectedConversationIds(new Set())
    setSubmitting(false)
  }

  const requestClose = useCallback(() => {
    if (submitting) return
    Keyboard.dismiss()
    onRequestClose()
  }, [onRequestClose, submitting])

  function handleAnimationComplete(nextOpen: boolean) {
    if (!nextOpen) resetForm()
    onAnimationComplete(nextOpen)
  }

  async function handleForward() {
    if (selectedConversationIds.size === 0 || submitting) return

    setSubmitting(true)
    let forwarded = false
    try {
      forwarded = await onForward(Array.from(selectedConversationIds))
    } finally {
      setSubmitting(false)
    }
    if (forwarded) requestClose()
  }

  function toggleConversation(conversationId: string) {
    if (submitting) return
    setSelectedConversationIds((current) => {
      const next = new Set(current)
      if (next.has(conversationId)) next.delete(conversationId)
      else next.add(conversationId)
      return next
    })
  }

  return (
    <QueryClientProvider client={queryClient}>
      <XGUIHalfScreenDialog
        closeButtonPosition="left"
        dismissible={!submitting}
        headerAction={
          <XGUIButton
            accessibilityLabel="确认转发"
            disabled={selectedConversationIds.size === 0 || submitting}
            loading={submitting}
            onPress={() => void handleForward()}
            size="mini"
            style={styles.forwardButton}
            textStyle={styles.primaryButtonText}
          >
            {selectedConversationIds.size > 0
              ? `转发(${selectedConversationIds.size})`
              : "转发"}
          </XGUIButton>
        }
        onAnimationComplete={handleAnimationComplete}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) requestClose()
        }}
        open={open}
        title="转发消息"
      >
        {source ? (
          <View style={styles.sourcePreview}>
            <AppAvatar
              accessibilityLabel={source.author}
              avatar={source.avatar}
              server={server}
              size={40}
              type="user"
            />
            <View style={styles.sourceBody}>
              <View style={styles.sourceHeader}>
                <Text
                  numberOfLines={1}
                  style={[styles.sourceAuthor, { color: colors.textPrimary }]}
                >
                  {source.author}
                </Text>
                <Text
                  style={[styles.sourceTime, { color: colors.textSecondary }]}
                >
                  {formatMessageTimeMarker(source.createdAt)}
                </Text>
              </View>
              <Text
                numberOfLines={2}
                style={[styles.sourceSummary, { color: colors.textPlaceholder }]}
              >
                {source.summary}
              </Text>
            </View>
          </View>
        ) : null}
        <HalfScreenSearchInput
          onChangeText={setKeyword}
          placeholder="搜索会话"
          value={keyword}
        />
        <FlatList
          contentContainerStyle={styles.content}
          data={visibleConversations}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(conversation) => conversation.id}
          renderItem={({ item: conversation }) => {
            const selected = selectedConversationIds.has(conversation.id)
            return (
              <HalfScreenSelectionRow
                accessibilityLabel={`${selected ? "取消选择" : "选择"}会话 ${conversation.name}`}
                checkbox
                leading={
                  <ConversationAvatar
                    conversation={conversation}
                    server={server}
                  />
                }
                onPress={() => toggleConversation(conversation.id)}
                selected={selected}
                title={conversation.name}
                value={conversationTypeLabel(conversation.type)}
              />
            )
          }}
          showsVerticalScrollIndicator={false}
        />
      </XGUIHalfScreenDialog>
    </QueryClientProvider>
  )
}

export type ForwardMessageSource = {
  author: string
  avatar: string
  createdAt: string
  summary: string
}

function conversationTypeLabel(type: ClientConversation["type"]) {
  if (type === "group") return "群聊"
  if (type === "app") return "应用"
  if (type === "topic") return "话题"
  return "私聊"
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 20,
  },
  forwardButton: {
    height: 32,
    minWidth: 64,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
  },
  sourceAuthor: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
  },
  sourceBody: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  sourceHeader: {
    alignItems: "center",
    flexDirection: "row",
  },
  sourcePreview: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sourceSummary: {
    fontSize: 12,
    lineHeight: 17,
    paddingTop: 2,
  },
  sourceTime: {
    fontSize: 12,
    lineHeight: 17,
    marginLeft: 12,
  },
})
