import { useRouter } from "expo-router"
import { useCallback, useEffect, useRef } from "react"
import { BackHandler } from "react-native"

import {
  buildConversationHref,
  buildTopicConversationHref,
} from "@/navigation/conversations"

export function useConversationNavigation({
  activateConversation,
  conversationId,
  isFocused,
  parentConversationId,
}: {
  activateConversation: (conversationId: string) => (() => void) | undefined
  conversationId: string
  isFocused: boolean
  parentConversationId: string
}) {
  const router = useRouter()
  const openingTopicRef = useRef(false)

  useEffect(() => {
    if (!isFocused || !conversationId) return
    return activateConversation(conversationId)
  }, [activateConversation, conversationId, isFocused])

  useEffect(() => {
    if (isFocused) openingTopicRef.current = false
  }, [isFocused])

  useEffect(() => {
    if (!isFocused || !parentConversationId) return

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        router.dismissTo(buildConversationHref(parentConversationId))
        return true
      }
    )
    return () => subscription.remove()
  }, [isFocused, parentConversationId, router])

  const openTopic = useCallback(
    (topicConversationId: string) => {
      if (openingTopicRef.current) return

      openingTopicRef.current = true
      router.push(
        buildTopicConversationHref(conversationId, topicConversationId)
      )
    },
    [conversationId, router]
  )

  const goBack = useCallback(() => {
    if (parentConversationId) {
      router.dismissTo(buildConversationHref(parentConversationId))
      return
    }
    router.back()
  }, [parentConversationId, router])

  return { goBack, openTopic }
}
