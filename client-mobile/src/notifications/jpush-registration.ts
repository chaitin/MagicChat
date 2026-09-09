import {
  type EventSubscription,
  requireOptionalNativeModule,
} from "expo-modules-core"
import { Platform } from "react-native"

import {
  normalizeJPushNotificationResponse,
  type JPushNotificationResponse,
  type NativeJPushNotificationResponse,
} from "@/notifications/jpush-notification-response"

type JPushRegistrationNativeModule = {
  addListener: (
    eventName: "onNotificationResponse",
    listener: (response: NativeJPushNotificationResponse) => void
  ) => EventSubscription
  clearLastNotificationResponseAsync: () => Promise<void>
  getLastNotificationResponseAsync: () => Promise<NativeJPushNotificationResponse | null>
  getRegistrationIdAsync: () => Promise<string>
  initializeAsync: (privacyAccepted: boolean) => Promise<boolean>
  isConfiguredAsync: () => Promise<boolean>
  stopAsync: () => Promise<void>
}

const nativeModule = requireOptionalNativeModule<JPushRegistrationNativeModule>(
  "MagicChatJPushRegistration"
)

const REGISTRATION_ID_POLL_ATTEMPTS = 20
const REGISTRATION_ID_POLL_INTERVAL_MS = 500

export async function isJPushConfigured() {
  return (
    Platform.OS === "android" &&
    Boolean(nativeModule) &&
    Boolean(await nativeModule?.isConfiguredAsync())
  )
}

export async function readJPushRegistrationID(privacyAccepted: boolean) {
  if (Platform.OS !== "android" || !nativeModule || !privacyAccepted) return ""
  if (!(await nativeModule.initializeAsync(true))) return ""
  for (let attempt = 0; attempt < REGISTRATION_ID_POLL_ATTEMPTS; attempt += 1) {
    const registrationId = (await nativeModule.getRegistrationIdAsync()).trim()
    if (registrationId) return registrationId
    if (attempt + 1 < REGISTRATION_ID_POLL_ATTEMPTS) {
      await delay(REGISTRATION_ID_POLL_INTERVAL_MS)
    }
  }
  return ""
}

export async function stopJPush() {
  if (Platform.OS !== "android" || !nativeModule) return
  await nativeModule.stopAsync()
}

export function addJPushNotificationResponseListener(
  listener: (response: JPushNotificationResponse) => void
) {
  if (Platform.OS !== "android" || !nativeModule) return null
  return nativeModule.addListener("onNotificationResponse", (response) => {
    const normalized = normalizeJPushNotificationResponse(response)
    if (normalized) listener(normalized)
  })
}

export async function getLastJPushNotificationResponse() {
  if (Platform.OS !== "android" || !nativeModule) return null
  return normalizeJPushNotificationResponse(
    await nativeModule.getLastNotificationResponseAsync()
  )
}

export async function clearLastJPushNotificationResponse() {
  if (Platform.OS !== "android" || !nativeModule) return
  await nativeModule.clearLastNotificationResponseAsync()
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
