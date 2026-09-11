import * as React from "react"
import { useLocation } from "react-router"

import { useClientData } from "@/lib/client-data-context"
import { useRealtime } from "@/lib/realtime-context"

const channelName = "client-user-directory"

export function ClientUserDirectoryRealtimeSync() {
  const location = useLocation()
  const {
    invalidateUsers,
    refreshContacts,
    refreshMe,
    updateUserPresence,
    usersById,
  } = useClientData()
  const { ready, subscribeRealtimeEvent } = useRealtime()
  const usersByIdRef = React.useRef(usersById)
  React.useEffect(() => {
    usersByIdRef.current = usersById
  }, [usersById])

  React.useEffect(() => {
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(channelName)
    const unsubscribe = subscribeRealtimeEvent(
      "user.profile.updated",
      (payload) => {
        const update = readProfileUpdate(payload)
        if (!update) return
        invalidateUsers([update.userId], update.updatedAt)
        channel?.postMessage({ type: "invalidate", ...update })
      }
    )
    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const update = readBroadcastProfileUpdate(event.data)
        if (update) invalidateUsers([update.userId], update.updatedAt)
      }
    }
    const unsubscribePresence = subscribeRealtimeEvent(
      "user.presence.updated",
      (payload) => {
        const update = readPresenceUpdate(payload)
        if (update) {
          updateUserPresence(update.userId, update.online, update.lastOnlineAt)
        }
      }
    )
    const unsubscribeNicknamePolicy = subscribeRealtimeEvent(
      "user.nickname.policy.updated",
      (payload) => {
        const update = readNicknamePolicyUpdate(payload)
        if (!update) return
        invalidateUsers(Object.keys(usersByIdRef.current), update.updatedAt)
        void refreshMe().catch(() => undefined)
      }
    )
    return () => {
      unsubscribe()
      unsubscribePresence()
      unsubscribeNicknamePolicy()
      channel?.close()
    }
  }, [invalidateUsers, refreshMe, subscribeRealtimeEvent, updateUserPresence])

  React.useEffect(() => {
    const refreshFriendData = () => {
      if (location.pathname.startsWith("/contacts")) {
        void refreshContacts().catch(() => undefined)
      }
    }
    const unsubscribers = [
      "friend.request.created",
      "friend.request.updated",
      "friendship.created",
      "friendship.deleted",
      "contact.directory.mode.updated",
    ].map((event) => subscribeRealtimeEvent(event, refreshFriendData))
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [location.pathname, refreshContacts, subscribeRealtimeEvent])

  React.useEffect(() => {
    if (ready) invalidateUsers(Object.keys(usersByIdRef.current))
  }, [invalidateUsers, ready])

  return null
}

function readProfileUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as { updated_at?: unknown; user_id?: unknown }
  return typeof value.user_id === "string" &&
    typeof value.updated_at === "string"
    ? { updatedAt: value.updated_at, userId: value.user_id }
    : null
}

function readNicknamePolicyUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as { updated_at?: unknown }
  return typeof value.updated_at === "string"
    ? { updatedAt: value.updated_at }
    : null
}

function readBroadcastProfileUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as {
    type?: unknown
    updatedAt?: unknown
    userId?: unknown
  }
  return value.type === "invalidate" &&
    typeof value.userId === "string" &&
    typeof value.updatedAt === "string"
    ? { updatedAt: value.updatedAt, userId: value.userId }
    : null
}

function readPresenceUpdate(payload: unknown) {
  if (!payload || typeof payload !== "object") return null
  const value = payload as {
    last_online_at?: unknown
    online?: unknown
    user_id?: unknown
  }
  if (typeof value.user_id !== "string" || typeof value.online !== "boolean") {
    return null
  }
  return {
    lastOnlineAt:
      typeof value.last_online_at === "string"
        ? value.last_online_at
        : undefined,
    online: value.online,
    userId: value.user_id,
  }
}
