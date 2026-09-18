import { createContext } from "react"
import type { MentionLabelResolver } from "@/lib/message-mentions"

export const MediaContext = createContext({ targetId: "", conversationName: "" })

export const MentionContext = createContext<{
  currentUserId: string
  resolveLabel: MentionLabelResolver
}>({ currentUserId: "", resolveLabel: () => undefined })
