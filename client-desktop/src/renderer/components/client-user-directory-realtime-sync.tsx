import * as React from "react"

import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

type FriendRefreshIntent = "directory" | "requests"

export function ClientUserDirectoryRealtimeSync() {
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const {
    invalidateUsers,
    refreshFriendData,
    refreshMe,
    updateUserPresence,
    usersById = {},
  } = useClientData()
  const usersByIdRef = React.useRef(usersById)
  const requestFriendRefreshRef = React.useRef<((intent: FriendRefreshIntent) => void) | null>(null)
  const wasReadyRef = React.useRef(false)

  React.useEffect(() => {
    usersByIdRef.current = usersById
  }, [usersById])

  React.useEffect(() => {
    const unsubscribeProfile = subscribeRealtimeEvent("user.profile.updated", (payload) => {
      const update = readProfileUpdate(payload)
      if (update && usersByIdRef.current[update.userId]) {
        invalidateUsers?.([update.userId], update.updatedAt)
      }
    })
    const unsubscribePresence = subscribeRealtimeEvent("user.presence.updated", (payload) => {
      const update = readPresenceUpdate(payload)
      if (update) updateUserPresence?.(update.userId, update.online, update.lastOnlineAt)
    })
    const unsubscribeNicknamePolicy = subscribeRealtimeEvent(
      "user.nickname.policy.updated",
      (payload) => {
        const update = readNicknamePolicyUpdate(payload)
        if (!update) return
        invalidateUsers?.(Object.keys(usersByIdRef.current), update.updatedAt)
        void refreshMe().catch(() => undefined)
      },
    )
    return () => {
      unsubscribeProfile()
      unsubscribePresence()
      unsubscribeNicknamePolicy()
    }
  }, [invalidateUsers, refreshMe, subscribeRealtimeEvent, updateUserPresence])

  React.useEffect(() => {
    let active = true
    let refreshRunning = false
    let refreshScheduled = false
    let queuedIntent: FriendRefreshIntent | null = null
    let trailingIntent: FriendRefreshIntent | null = null

    const mergeIntent = (
      current: FriendRefreshIntent | null,
      next: FriendRefreshIntent,
    ): FriendRefreshIntent =>
      current === "directory" || next === "directory" ? "directory" : "requests"

    const runRefresh = async (intent: FriendRefreshIntent) => {
      try {
        await refreshFriendData({ includeContacts: intent === "directory" })
      } catch {
        // 单次刷新失败不能中断 realtime 事件回调链。
      }
    }

    const requestFriendRefresh = (intent: FriendRefreshIntent) => {
      if (!active) return
      if (refreshRunning) {
        trailingIntent = mergeIntent(trailingIntent, intent)
        return
      }
      queuedIntent = mergeIntent(queuedIntent, intent)
      if (refreshScheduled) return
      refreshScheduled = true
      queueMicrotask(() => {
        refreshScheduled = false
        if (!active || refreshRunning || !queuedIntent) return
        const initialIntent = queuedIntent
        queuedIntent = null
        refreshRunning = true
        void (async () => {
          await runRefresh(initialIntent)
          while (active && trailingIntent) {
            const nextIntent = trailingIntent
            trailingIntent = null
            await runRefresh(nextIntent)
          }
          refreshRunning = false
        })()
      })
    }

    requestFriendRefreshRef.current = requestFriendRefresh
    const unsubscribers = [
      subscribeRealtimeEvent("friend.request.created", (payload) => {
        if (isFriendRequestEvent(payload)) requestFriendRefresh("requests")
      }),
      subscribeRealtimeEvent("friend.request.updated", (payload) => {
        if (isFriendRequestEvent(payload)) requestFriendRefresh("requests")
      }),
      subscribeRealtimeEvent("friendship.created", (payload) => {
        if (isFriendshipEvent(payload)) requestFriendRefresh("directory")
      }),
      subscribeRealtimeEvent("friendship.deleted", (payload) => {
        if (isFriendshipEvent(payload)) requestFriendRefresh("directory")
      }),
      subscribeRealtimeEvent("contact.directory.mode.updated", (payload) => {
        if (isDirectoryModeEvent(payload)) requestFriendRefresh("directory")
      }),
    ]

    return () => {
      active = false
      requestFriendRefreshRef.current = null
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [refreshFriendData, subscribeRealtimeEvent])

  React.useEffect(() => {
    const becameReady = ready && !wasReadyRef.current
    wasReadyRef.current = ready
    if (!becameReady) return
    invalidateUsers?.(Object.keys(usersByIdRef.current))
    requestFriendRefreshRef.current?.("directory")
  }, [invalidateUsers, ready])

  return null
}

function readProfileUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as { updated_at?: unknown; user_id?: unknown }
  if (
    typeof value.user_id !== "string" ||
    !value.user_id.trim() ||
    typeof value.updated_at !== "string" ||
    Number.isNaN(Date.parse(value.updated_at))
  ) {
    return null
  }
  return { updatedAt: value.updated_at, userId: value.user_id }
}

function readPresenceUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as { last_online_at?: unknown; online?: unknown; user_id?: unknown }
  if (
    typeof value.user_id !== "string" ||
    !value.user_id.trim() ||
    typeof value.online !== "boolean"
  ) {
    return null
  }
  if (
    value.last_online_at !== undefined &&
    (typeof value.last_online_at !== "string" || Number.isNaN(Date.parse(value.last_online_at)))
  ) {
    return null
  }
  return {
    lastOnlineAt: value.last_online_at,
    online: value.online,
    userId: value.user_id,
  }
}

function readNicknamePolicyUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const value = payload as { updated_at?: unknown }
  if (typeof value.updated_at !== "string" || Number.isNaN(Date.parse(value.updated_at))) {
    return null
  }
  return { updatedAt: value.updated_at }
}

function isFriendRequestEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) &&
    typeof payload.request_id === "string" &&
    Boolean(payload.request_id.trim())
  )
}

function isFriendshipEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) &&
    (payload.request_id === undefined ||
      (typeof payload.request_id === "string" && Boolean(payload.request_id.trim())))
  )
}

function isDirectoryModeEvent(payload: unknown) {
  return (
    isRealtimeRecord(payload) && (payload.mode === "organization" || payload.mode === "friends")
  )
}

function isRealtimeRecord(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload)
}
