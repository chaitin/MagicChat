import { createContext, useContext } from "react"

import type { AuthenticatedTarget } from "@/core/server-target"
import type {
  RealtimeConnectionStatus,
  RealtimeSnapshot,
} from "@/realtime/realtime-client"

export type RealtimeContextValue = RealtimeSnapshot & {
  activateConversation: (conversationId: string) => () => void
  waitUntilReady: (
    target: AuthenticatedTarget,
    options: { attempts: number; timeoutMs: number }
  ) => Promise<void>
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext)

  if (!value) {
    throw new Error("useRealtime 必须在 RealtimeProvider 内使用")
  }

  return value
}

export const DISCONNECTED_REALTIME_SNAPSHOT: RealtimeContextValue = {
  activateConversation: () => () => undefined,
  ready: false,
  status: "disconnected" satisfies RealtimeConnectionStatus,
  waitUntilReady: async () => {
    throw new Error("实时连接尚未初始化")
  },
}
