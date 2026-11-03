import { useFocusEffect, useIsFocused, useRouter } from "expo-router"
import { useCallback, useRef } from "react"

import type { ClientVideoMessageBody } from "@/core/models"
import { buildVideoPreviewHref, buildVideoPreviewScope } from "@/navigation/video-preview"
import { useAuth } from "@/providers/auth-provider"

export function useOpenVideoPreview() {
  const router = useRouter()
  const focused = useIsFocused()
  const { session, generation, phase } = useAuth()
  const openingRef = useRef(false)
  useFocusEffect(useCallback(() => {
    openingRef.current = false
    return () => { openingRef.current = true }
  }, []))

  return useCallback((source: ClientVideoMessageBody) => {
    if (!focused || openingRef.current || !session || phase !== "authenticated") return
    openingRef.current = true
    try {
      router.push(buildVideoPreviewHref(source, buildVideoPreviewScope(session, generation)))
    } catch (error) {
      openingRef.current = false
      throw error
    }
  }, [focused, generation, phase, router, session])
}
