import { useIsFocused, useRouter } from "expo-router"
import { createContext, useCallback, useContext, useEffect, useRef, useMemo, type PropsWithChildren } from "react"
import { Alert } from "react-native"

import type { ClientForwardBundleMessageBody } from "@/core/models"
import { createChatRecordStore, type ChatRecordStore } from "@/features/chat-records/chat-record-model"
import { buildChatRecordHref } from "@/navigation/chat-records"

const ChatRecordContext = createContext<ChatRecordStore | null>(null)

export function ChatRecordProvider({ children, scopeKey }: PropsWithChildren<{ scopeKey: string }>) {
  const store = useMemo(() => createChatRecordStore(scopeKey), [scopeKey])
  return <ChatRecordContext.Provider value={store}>{children}</ChatRecordContext.Provider>
}

export function useChatRecordStore() {
  const store = useContext(ChatRecordContext)
  if (!store) throw new Error("聊天记录需要在已登录的页面内打开")
  return store
}

export function useOpenChatRecord() {
  const store = useChatRecordStore()
  const router = useRouter()
  const focused = useIsFocused()
  const openingRef = useRef(false)
  useEffect(() => { if (focused) openingRef.current = false }, [focused, store])
  return useCallback((body: ClientForwardBundleMessageBody) => {
    if (!focused || openingRef.current) return
    openingRef.current = true
    const id = store.add(body)
    try {
      router.push(buildChatRecordHref(id))
    } catch {
      store.remove(id)
      openingRef.current = false
      Alert.alert("无法打开", "聊天记录暂时无法打开，请重试。")
    }
  }, [focused, router, store])
}
