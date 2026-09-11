import AsyncStorage from "@react-native-async-storage/async-storage"
import * as SecureStore from "expo-secure-store"

import {
  EMPTY_PUSH_REMINDER_STATE,
  parsePushReminderState,
  type PushReminderState,
} from "@/notifications/push-reminder"
import {
  parsePendingPushRouteQueue,
  parsePushDelegation,
  parsePushInstallation,
  type PendingPushRoute,
  type PushDelegation,
  type PushInstallation,
} from "@/notifications/push-types"
import {
  appendPendingPushRoute,
  removePendingPushRoute,
} from "@/notifications/push-route-queue"
import { createPushRevocationQueueStore } from "@/notifications/push-revocation-queue-store"

const INSTALLATION_KEY = "magicchat.push.installation.v1"
const DELEGATION_KEY = "magicchat.push.delegation.v1"
const PENDING_ROUTE_KEY = "magicchat.push.pending-route.v1"
const JPUSH_CONSENT_KEY = "magicchat.push.jpush-consent.v1"
const PUSH_REMINDER_KEY = "magicchat.push.reminder.v1"
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
}

export async function loadJPushConsent() {
  return (await loadSecureValue(JPUSH_CONSENT_KEY, parseBoolean)) ?? false
}

export async function saveJPushConsent(value: boolean) {
  await saveSecureValue(JPUSH_CONSENT_KEY, value)
}

export async function loadPushReminderState() {
  return (
    (await loadSecureValue(PUSH_REMINDER_KEY, parsePushReminderState)) ??
    EMPTY_PUSH_REMINDER_STATE
  )
}

export async function savePushReminderState(value: PushReminderState) {
  await saveSecureValue(PUSH_REMINDER_KEY, value)
}

let pushReminderUpdateQueue = Promise.resolve()
export function updatePushReminderState(
  update: (state: PushReminderState) => PushReminderState
) {
  const operation = pushReminderUpdateQueue.then(async () => {
    const current = await loadPushReminderState()
    const next = update(current)
    if (next !== current) await savePushReminderState(next)
    return next
  })
  pushReminderUpdateQueue = operation.then(() => undefined, () => undefined)
  return operation
}

export async function loadPushInstallation() {
  return loadSecureValue(INSTALLATION_KEY, parsePushInstallation)
}

export async function savePushInstallation(value: PushInstallation) {
  await saveSecureValue(INSTALLATION_KEY, value)
}

export async function loadPushDelegation() {
  return loadSecureValue(DELEGATION_KEY, parsePushDelegation)
}

export async function savePushDelegation(value: PushDelegation) {
  await saveSecureValue(DELEGATION_KEY, value)
}

export async function clearPushDelegation() {
  await deleteSecureValue(DELEGATION_KEY)
}

const revocationQueue = createPushRevocationQueueStore(AsyncStorage)
export const loadPendingPushRevocations = revocationQueue.load
export const replacePendingPushRevocations = revocationQueue.replace
export const enqueuePendingPushRevocation = revocationQueue.enqueue

export async function loadPendingPushRoutes() {
  return (
    (await loadSecureValue(PENDING_ROUTE_KEY, parsePendingPushRouteQueue)) ?? []
  )
}

export async function enqueuePendingPushRoute(value: PendingPushRoute) {
  const current = await loadPendingPushRoutes()
  await replacePendingPushRoutes(appendPendingPushRoute(current, value))
}

export async function consumePendingPushRoute(value: PendingPushRoute) {
  const current = await loadPendingPushRoutes()
  await replacePendingPushRoutes(removePendingPushRoute(current, value))
}

export async function replacePendingPushRoutes(values: PendingPushRoute[]) {
  if (values.length === 0) {
    await deleteSecureValue(PENDING_ROUTE_KEY)
    return
  }
  await saveSecureValue(
    PENDING_ROUTE_KEY,
    values
  )
}

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null
}

async function loadSecureValue<T>(
  key: string,
  parse: (value: unknown) => T | null
): Promise<T | null> {
  if (!(await SecureStore.isAvailableAsync())) return null
  const stored = await SecureStore.getItemAsync(key, secureStoreOptions)
  if (!stored) return null
  try {
    return parse(JSON.parse(stored))
  } catch {
    return null
  }
}

async function saveSecureValue(key: string, value: unknown) {
  if (!(await SecureStore.isAvailableAsync())) return
  await SecureStore.setItemAsync(
    key,
    JSON.stringify(value),
    secureStoreOptions
  )
}

async function deleteSecureValue(key: string) {
  if (!(await SecureStore.isAvailableAsync())) return
  await SecureStore.deleteItemAsync(key, secureStoreOptions)
}
