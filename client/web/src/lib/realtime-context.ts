import { createContext, useContext } from "react"

import type {
  RealtimeConnectionStatus,
  RealtimeEventHandler,
} from "@/lib/realtime-client"

export type RealtimeContextValue = {
  ready: boolean
  sendRealtimeRequest: (method: string, payload: unknown) => Promise<unknown>
  status: RealtimeConnectionStatus
  subscribeRealtimeEvent: (
    eventName: string,
    handler: RealtimeEventHandler
  ) => () => void
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null)

export function useRealtime() {
  const context = useContext(RealtimeContext)

  if (!context) {
    throw new Error("useRealtime must be used within ClientRealtimeProvider")
  }

  return context
}
