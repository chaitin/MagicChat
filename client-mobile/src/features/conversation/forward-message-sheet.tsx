import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { BlurView } from "expo-blur"
import { Check, Search, X } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Keyboard, Pressable, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Avatar,
  ListItem,
  ScrollView,
  Sheet,
  SizableText,
  Spinner,
  useThemeName,
  XStack,
  YStack,
} from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { ListItemContent } from "@/components/lists/list-item-content"
import { useSheetBackHandler } from "@/components/overlays/use-sheet-back-handler"
import type { ClientConversation } from "@/data/models"
import type { ServerTarget } from "@/data/query"
import { orderConversations } from "@/domain/conversations/conversation-order"
import { formatMessageTimeMarker } from "@/domain/messages/message-presenter"
import { ConversationAvatar } from "@/features/messages/conversation-avatar"
import { useAppBlurTarget } from "@/providers/app-blur-target"

const KEYBOARD_CLEARANCE = 36

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
  const blurTarget = useAppBlurTarget()
  const insets = useSafeAreaInsets()
  const themeName = useThemeName()
  const [keyboardInset, setKeyboardInset] = useState(0)
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
    setKeyboardInset(0)
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
    if (forwarded) {
      requestClose()
    }
  }

  function toggleConversation(conversationId: string) {
    if (submitting) return

    setSelectedConversationIds((current) => {
      const next = new Set(current)
      if (next.has(conversationId)) {
        next.delete(conversationId)
      } else {
        next.add(conversationId)
      }
      return next
    })
  }

  useSheetBackHandler({
    disabled: submitting,
    onDismiss: requestClose,
    open,
  })

  useEffect(() => {
    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      (event) => {
        setKeyboardInset(
          Math.max(0, event.endCoordinates.height - insets.bottom)
        )
      }
    )
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardInset(0)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [insets.bottom])

  return (
    <Sheet
      disableDrag
      dismissOnOverlayPress
      modal
      onAnimationComplete={({ open: animationOpen }) =>
        handleAnimationComplete(animationOpen)
      }
      onOpenChange={(nextOpen: boolean) => {
        if (!nextOpen) requestClose()
      }}
      open={open}
      snapPoints={[72]}
    >
      <Sheet.Overlay bg="transparent" overflow="hidden">
        <Pressable
          accessibilityLabel="关闭转发消息"
          disabled={submitting}
          onPress={requestClose}
          style={StyleSheet.absoluteFill}
        >
          <BlurView
            blurMethod="dimezisBlurView"
            blurReductionFactor={3}
            blurTarget={blurTarget}
            intensity={45}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            tint={themeName.startsWith("dark") ? "dark" : "light"}
          />
        </Pressable>
      </Sheet.Overlay>
      <Sheet.Handle bg="$color6" />
      <Sheet.Frame bg="$background" overflow="hidden">
        <QueryClientProvider client={queryClient}>
          <YStack
            flex={1}
            pb={
              Math.max(insets.bottom, 12) +
              keyboardInset +
              (keyboardInset > 0 ? KEYBOARD_CLEARANCE : 0)
            }
          >
            <YStack pb="$3" shrink={0}>
              <XStack height={42} items="center" justify="center" px="$4">
                <SizableText fontWeight="600" size="$4">
                  转发消息
                </SizableText>
                <XStack position="absolute" r={0}>
                  <CompactIconButton
                    accessibilityLabel="关闭转发消息"
                    disabled={submitting}
                    icon={X}
                    iconSize={20}
                    onPress={requestClose}
                    strokeWidth={1.5}
                  />
                </XStack>
              </XStack>

              {source ? (
                <ListItem
                  bg="transparent"
                  icon={
                    <ForwardMessageAvatar server={server} source={source} />
                  }
                  pointerEvents="none"
                  size="$4"
                  title={
                    <ListItemContent
                      meta={formatMessageTimeMarker(source.createdAt)}
                      subtitle={source.summary}
                      title={source.author}
                    />
                  }
                />
              ) : null}

              <XStack
                bg="$color1"
                gap="$1"
                height={40}
                items="center"
                mt="$3"
                mx="$4"
                px="$3"
                rounded="$4"
              >
                <XStack pointerEvents="none">
                  <ThemedIcon icon={Search} size={17} />
                </XStack>
                <AppInput
                  bg="transparent"
                  borderWidth={0}
                  disabled={submitting}
                  flex={1}
                  focusStyle={{ borderWidth: 0, outlineWidth: 0 }}
                  height={40}
                  minW={0}
                  onChangeText={setKeyword}
                  p={0}
                  placeholder="搜索会话"
                  placeholderTextColor="$gray9"
                  size="$3"
                  unstyled
                  value={keyword}
                />
              </XStack>
            </YStack>

            <YStack flex={1} minH={0} overflow="hidden">
              <ScrollView flex={1} keyboardShouldPersistTaps="handled">
                <YStack px="$2" pb="$3">
                  {visibleConversations.map((conversation) => {
                    const selected = selectedConversationIds.has(
                      conversation.id
                    )
                    return (
                      <Pressable
                        accessibilityLabel={`选择会话 ${conversation.name}`}
                        accessibilityRole="checkbox"
                        accessibilityState={{ selected }}
                        disabled={submitting}
                        key={conversation.id}
                        onPress={() => toggleConversation(conversation.id)}
                      >
                        {({ pressed }) => (
                          <ListItem
                            accessible={false}
                            bg={
                              selected
                                ? pressed
                                  ? "$color5"
                                  : "$color4"
                                : pressed
                                  ? "$backgroundPress"
                                  : "transparent"
                            }
                            icon={
                              <ConversationAvatar
                                conversation={conversation}
                                server={server}
                                surroundingBackground={
                                  selected
                                    ? pressed
                                      ? "$color5"
                                      : "$color4"
                                    : pressed
                                      ? "$backgroundPress"
                                      : "$background"
                                }
                              />
                            }
                            iconAfter={
                              <XStack
                                items="center"
                                justify="center"
                                width={24}
                              >
                                {selected ? (
                                  <ThemedIcon icon={Check} size={18} />
                                ) : null}
                              </XStack>
                            }
                            pointerEvents="none"
                            size="$4"
                            title={
                              <ListItemContent
                                subtitle={conversationTypeLabel(
                                  conversation.type
                                )}
                                title={conversation.name}
                              />
                            }
                          />
                        )}
                      </Pressable>
                    )
                  })}
                  {visibleConversations.length === 0 ? (
                    <SizableText color="$color10" py="$8" text="center">
                      没有匹配的会话
                    </SizableText>
                  ) : null}
                </YStack>
              </ScrollView>
            </YStack>

            <XStack bg="$background" px="$4" pt="$2" shrink={0}>
              <AppButton
                accessibilityLabel="确认转发"
                disabled={selectedConversationIds.size === 0 || submitting}
                disabledStyle={{ opacity: 0.5 }}
                icon={submitting ? <Spinner size="small" /> : undefined}
                onPress={() => void handleForward()}
                theme="accent"
                width="100%"
              >
                {submitting
                  ? "转发中…"
                  : selectedConversationIds.size > 0
                    ? `选中 ${selectedConversationIds.size} 个对话`
                    : "选择对话"}
              </AppButton>
            </XStack>
          </YStack>
        </QueryClientProvider>
      </Sheet.Frame>
    </Sheet>
  )
}

export type ForwardMessageSource = {
  author: string
  avatar: string
  createdAt: string
  summary: string
}

function ForwardMessageAvatar({
  server,
  source,
}: {
  server: ServerTarget
  source: ForwardMessageSource
}) {
  return (
    <Avatar rounded="$2" size="$4">
      <CachedAvatarImage avatar={source.avatar} server={server} />
      <Avatar.Fallback bg="$backgroundFocus" items="center" justify="center">
        <SizableText fontWeight="600">
          {Array.from(source.author.trim())[0]?.toUpperCase() ?? "?"}
        </SizableText>
      </Avatar.Fallback>
    </Avatar>
  )
}

function conversationTypeLabel(type: ClientConversation["type"]) {
  if (type === "group") return "群聊"
  if (type === "app") return "应用"
  if (type === "topic") return "话题"
  return "私聊"
}
