import type { QueryClient } from "@tanstack/react-query"
import * as Notifications from "expo-notifications"
import { AppState, Platform } from "react-native"

import type { ClientConversation, ClientMessage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import type { PushAccountIdentity } from "@/notifications/push-types"
import { queryKeys } from "@/data/query"
import { shouldShowMessageNotification } from "@/notifications/message-notification-policy"
const MESSAGE_CHANNEL_ID = "messages"

let notificationsAllowed = false
let notificationPreparation: Promise<boolean> | null = null

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const appIsActive = AppState.currentState === "active"
      return {
        shouldPlaySound: !appIsActive,
        shouldSetBadge: false,
        shouldShowBanner: !appIsActive,
        shouldShowList: !appIsActive,
      }
    },
  })
}

export function prepareMessageNotifications() {
  if (notificationPreparation) return notificationPreparation
  const operation = prepareMessageNotificationsOnce()
  notificationPreparation = operation
  void operation.then(
    () => {
      if (notificationPreparation === operation) notificationPreparation = null
    },
    () => {
      if (notificationPreparation === operation) notificationPreparation = null
    }
  )
  return operation
}

async function prepareMessageNotificationsOnce() {
  if (Platform.OS === "web") {
    return false
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
      enableVibrate: true,
      importance: Notifications.AndroidImportance.HIGH,
      name: "消息通知",
      showBadge: true,
      vibrationPattern: [0, 250, 150, 250],
    })
  }

  let permission = await Notifications.getPermissionsAsync()
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync()
  }

  let messageChannelEnabled = true
  if (Platform.OS === "android" && permission.granted) {
    const channel = await Notifications.getNotificationChannelAsync(
      MESSAGE_CHANNEL_ID
    )
    messageChannelEnabled =
      channel?.importance !== Notifications.AndroidImportance.NONE
  }

  notificationsAllowed = permission.granted && messageChannelEnabled
  return notificationsAllowed
}

export async function showBackgroundMessageNotification(
  queryClient: QueryClient,
  server: AuthenticatedTarget,
  message: ClientMessage,
  options: { notificationMuted?: boolean; identity?: PushAccountIdentity } = {}
) {
  if (Platform.OS === "web" || !notificationsAllowed) {
    return
  }

  const conversations = queryClient.getQueryData<ClientConversation[]>(
    queryKeys.conversations(server)
  )
  const conversation = conversations?.find(
    (item) => item.id === message.conversationId
  )
  if (!shouldShowMessageNotification({
    cachedConversationMuted: conversation?.notificationMuted,
    message,
    notificationMuted: options.notificationMuted,
    recipientUserId: server.userId,
  })) {
    return
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      body: "你收到一条新消息",
      data: {
        accountId: options.identity?.accountId,
        conversationId: message.conversationId,
        generation: options.identity?.generation,
        serverId: server.id,
        serverUrl: server.url,
        userId: server.userId,
      },
      sound: "default",
      title: "即应",
    },
    identifier: message.id,
    trigger:
      Platform.OS === "android" ? { channelId: MESSAGE_CHANNEL_ID } : null,
  })
}
