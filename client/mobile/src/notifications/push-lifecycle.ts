import * as Application from "expo-application"
import * as Notifications from "expo-notifications"
import { Platform } from "react-native"

import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import { readJPushRegistrationID, isJPushConfigured } from "@/notifications/jpush-registration"
import { prepareMessageNotifications } from "@/notifications/message-notifications"
import {
  createActivePushGrant,
  pushGatewayCredentialIsInvalid,
  pushGatewayInstallationIsDisabled,
  registerPushInstallation,
  renewPushGrant,
  revokePushGrant,
  updatePushProviderToken,
} from "@/notifications/push-gateway-api"
import {
  registerPrivatePushGrant,
  revokePrivatePushGrant,
} from "@/notifications/push-private-server-api"
import {
  clearPushDelegation,
  enqueuePendingPushRevocation,
  loadPendingPushRevocations,
  replacePendingPushRevocations,
  loadJPushConsent,
  loadPushDelegation,
  loadPushInstallation,
  loadPushReminderState,
  savePushDelegation,
  savePushInstallation,
} from "@/notifications/push-registration-store"
import { setActiveRemotePushTarget } from "@/notifications/push-runtime-state"
import {
  shouldRefreshPrivateRegistration,
  shouldRenewPushGrant,
  targetsMatch,
  type PushDelegation,
  type PushEnvironment,
  type PushInstallation,
  type PushAccountIdentity,
  type PushPlatform,
  type PushProviderName,
  type PendingPushRevocation,
} from "@/notifications/push-types"

const PRIVATE_PUSH_REGISTRATION_VERSION = 2

export function synchronizePushDelegation(
  identity: PushAccountIdentity,
  options: { deviceToken?: string } = {}
) {
  return synchronizeRemotePush(identity, options)
}

export async function getPushInstallationID(identity: PushAccountIdentity) {
  const delegation = await loadPushDelegation()
  return delegation && delegation.accountId === identity.accountId && targetsMatch(delegation.target, identity.target)
    ? delegation.installationId
    : undefined
}

export async function queuePushDelegationRevocation(
  identity: PushAccountIdentity,
  privateRevoked = false
) {
  const delegation = await loadPushDelegation()
  if (!delegation || delegation.accountId !== identity.accountId || !targetsMatch(delegation.target, identity.target)) return
  setActiveRemotePushTarget(null)
  await enqueuePendingPushRevocation(toPendingRevocation(delegation, privateRevoked))
  await clearPushDelegation()
}

export async function deactivatePushDelegation(
  identity?: PushAccountIdentity
) {
  const delegation = await loadPushDelegation()
  if (!delegation || (identity && (delegation.accountId !== identity.accountId || !targetsMatch(delegation.target, identity.target)))) {
    if (!identity) setActiveRemotePushTarget(null)
    return
  }
  await markAndRevokeDelegation(delegation, await loadPushInstallation())
}

export async function flushPendingPushRevocation() {
  const entries = await loadPendingPushRevocations()
  const installation = await loadPushInstallation()
  for (const entry of entries) {
    await revokeStoredDelegation(entry, installation)
    await replacePendingPushRevocations((await loadPendingPushRevocations()).filter((item) =>
      !(item.accountId === entry.accountId && item.grantId === entry.grantId)))
  }
}

async function synchronizeRemotePush(
  identity: PushAccountIdentity,
  options: { deviceToken?: string }
) {
  const target = identity.target
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    setActiveRemotePushTarget(null)
    return false
  }

  if ((await loadPushReminderState()).explicitlyDisabled) {
    setActiveRemotePushTarget(null)
    throw new PushLifecycleError(
      "push_user_disabled",
      "用户已关闭手机通知"
    )
  }

  let delegation = await loadPushDelegation()
  if (
    delegation?.status === "registered" &&
    delegation.accountId === identity.accountId && targetsMatch(delegation.target, identity.target) &&
    Date.parse(delegation.expiresAt) > Date.now()
  ) {
    setActiveRemotePushTarget(identity)
  } else {
    setActiveRemotePushTarget(null)
  }

  if (Platform.OS === "android") {
    if (!(await isJPushConfigured())) {
      throw new PushLifecycleError(
        "android_provider_unavailable",
        "当前安装包未配置 JPush"
      )
    }
    if (!(await loadJPushConsent())) {
      throw new PushLifecycleError(
        "jpush_consent_required",
        "需要先同意启用 JPush 通知"
      )
    }
  }

  if (!(await prepareMessageNotifications())) {
    if (delegation && delegation.accountId === identity.accountId && targetsMatch(delegation.target, identity.target)) {
      await markAndRevokeDelegation(
        delegation,
        await loadPushInstallation()
      )
    }
    return false
  }

  const device = await readRemotePushDevice(options.deviceToken)
  if (!device) {
    throw new PushLifecycleError(
      "push_environment_unavailable",
      "推送设备信息暂不可用"
    )
  }
  const appVersion = Application.nativeApplicationVersion ?? "unknown"

  let installation = await loadPushInstallation()
  if (
    !installation ||
    installation.environment !== device.environment ||
    installation.platform !== device.platform ||
    installation.provider !== device.provider
  ) {
    if (delegation) {
      await markAndRevokeDelegation(delegation, installation)
      delegation = null
    }
    installation = await createInstallation(
      device.token,
      device.environment,
      device.platform,
      device.provider,
      appVersion
    )
  } else if (
    installation.providerToken !== device.token ||
    installation.appVersion !== appVersion
  ) {
    try {
      await updatePushProviderToken(
        installation.installationId,
        installation.managementToken,
        { appVersion, providerToken: device.token }
      )
      installation = {
        ...installation,
        appVersion,
        providerToken: device.token,
      }
      await savePushInstallation(installation)
    } catch (error) {
      if (!pushGatewayCredentialIsInvalid(error)) throw error
      if (delegation) {
        await abandonInvalidDelegation(delegation, installation)
        delegation = null
      }
      installation = await createInstallation(
        device.token,
        device.environment,
        device.platform,
        device.provider,
        appVersion
      )
    }
  }
  if (!installation) {
    throw new Error("推送安装凭据不可用")
  }

  delegation = delegation ?? (await loadPushDelegation())
  if (
    delegation &&
    (delegation.installationId !== installation.installationId ||
      delegation.accountId !== identity.accountId || !targetsMatch(delegation.target, identity.target) ||
      delegation.status === "pending_revocation")
  ) {
    await markAndRevokeDelegation(delegation, installation)
    delegation = null
  }

  if (delegation && shouldRenewPushGrant(delegation.expiresAt)) {
    try {
      const renewed = await renewPushGrant(
        delegation.grantId,
        installation.managementToken
      )
      delegation = {
        ...delegation,
        expiresAt: renewed.expiresAt,
        lastSyncedAt: null,
        status: "pending_registration",
      }
      await savePushDelegation(delegation)
    } catch (error) {
      if (!pushGatewayCredentialIsInvalid(error)) throw error
      await abandonInvalidDelegation(delegation, installation)
      delegation = null
    }
  }

  if (!delegation) {
    const recovered = await createGrantWithInstallationRecovery(installation)
    installation = recovered.installation
    const grant = recovered.grant
    delegation = {
      expiresAt: grant.expiresAt,
      grantId: grant.grantId,
      installationId: installation.installationId,
      lastSyncedAt: null,
      platform: installation.platform,
      privateRegistrationVersion: PRIVATE_PUSH_REGISTRATION_VERSION,
      sendToken: grant.sendToken,
      status: "pending_registration",
      accountId: identity.accountId,
      target,
    }
    await savePushDelegation(delegation)
  }

  if (
    delegation.status !== "registered" ||
    delegation.privateRegistrationVersion !== PRIVATE_PUSH_REGISTRATION_VERSION ||
    shouldRefreshPrivateRegistration(delegation.lastSyncedAt)
  ) {
    try {
      await registerPrivatePushGrant(target, delegation)
    } catch (error) {
      if (privatePushRegistrationIsPermanentlyRejected(error)) {
        await markAndRevokeDelegation(delegation, installation)
      }
      throw error
    }
    delegation = {
      ...delegation,
      lastSyncedAt: new Date().toISOString(),
      privateRegistrationVersion: PRIVATE_PUSH_REGISTRATION_VERSION,
      status: "registered",
    }
    await savePushDelegation(delegation)
  }

  setActiveRemotePushTarget(identity)
  return true
}

async function createInstallation(
  providerToken: string,
  environment: PushEnvironment,
  platform: PushPlatform,
  provider: PushProviderName,
  appVersion: string
): Promise<PushInstallation> {
  const credential = await registerPushInstallation({
    appVersion,
    environment,
    platform,
    provider,
    providerToken,
  })
  const installation = {
    appVersion,
    environment,
    installationId: credential.installationId,
    managementToken: credential.managementToken,
    platform,
    provider,
    providerToken,
  }
  await savePushInstallation(installation)
  return installation
}

async function markAndRevokeDelegation(
  delegation: PushDelegation,
  installation: PushInstallation | null
) {
  setActiveRemotePushTarget(null)
  const pending = toPendingRevocation(delegation)
  await enqueuePendingPushRevocation(pending)
  await clearPushDelegation()
  await revokeStoredDelegation(pending, installation)
  await replacePendingPushRevocations((await loadPendingPushRevocations()).filter((item) =>
    !(item.accountId === pending.accountId && item.grantId === pending.grantId)))
}

async function revokeStoredDelegation(
  delegation: PendingPushRevocation,
  installation: PushInstallation | null
) {
  let gatewayError: unknown
  if (
    !delegation.gatewayRevoked &&
    installation &&
    installation.installationId === delegation.installationId
  ) {
    try {
      await revokePushGrant(
        delegation.grantId,
        installation.managementToken
      )
    } catch (error) {
      if (!pushGatewayCredentialIsInvalid(error)) gatewayError = error
    }
  }
  if (!delegation.privateRevoked) {
    try {
      await revokePrivatePushGrant(
        delegation.target,
        delegation.accountId,
        delegation.installationId,
        delegation.grantId
      )
    } catch (error) {
      if (!isUnauthorizedError(error)) throw error
    }
  }
  if (gatewayError) throw gatewayError
}

function toPendingRevocation(
  delegation: PushDelegation,
  privateRevoked = false,
  gatewayRevoked = false
): PendingPushRevocation {
  return {
    accountId: delegation.accountId,
    gatewayRevoked,
    grantId: delegation.grantId,
    installationId: delegation.installationId,
    privateRevoked,
    queuedAt: new Date().toISOString(),
    target: delegation.target,
  }
}

async function abandonInvalidDelegation(
  delegation: PushDelegation,
  installation: PushInstallation | null
) {
  setActiveRemotePushTarget(null)
  const pending = toPendingRevocation(delegation, false, true)
  await enqueuePendingPushRevocation(pending)
  await clearPushDelegation()
  try {
    await revokeStoredDelegation(pending, installation)
    await replacePendingPushRevocations(
      (await loadPendingPushRevocations()).filter(
        (item) =>
          !(item.accountId === pending.accountId && item.grantId === pending.grantId)
      )
    )
  } catch {
    // The durable queue retries private cleanup without blocking a replacement grant.
  }
}

async function createGrantWithInstallationRecovery(
  installation: PushInstallation
) {
  try {
    return {
      grant: await createActivePushGrant(
        installation.installationId,
        installation.managementToken
      ),
      installation,
    }
  } catch (error) {
    if (pushGatewayInstallationIsDisabled(error)) {
      await updatePushProviderToken(
        installation.installationId,
        installation.managementToken,
        {
          appVersion: installation.appVersion,
          providerToken: installation.providerToken,
        }
      )
      return {
        grant: await createActivePushGrant(
          installation.installationId,
          installation.managementToken
        ),
        installation,
      }
    }
    if (!pushGatewayCredentialIsInvalid(error)) throw error
    const replacement = await createInstallation(
      installation.providerToken,
      installation.environment,
      installation.platform,
      installation.provider,
      installation.appVersion
    )
    return {
      grant: await createActivePushGrant(
        replacement.installationId,
        replacement.managementToken
      ),
      installation: replacement,
    }
  }
}

async function readRemotePushDevice(
  pendingDeviceToken?: string
): Promise<{
  environment: PushEnvironment
  platform: PushPlatform
  provider: PushProviderName
  token: string
} | null> {
  if (Platform.OS === "ios") {
    const token = pendingDeviceToken?.trim() || (await readIOSDeviceToken())
    const environment = await readPushEnvironment()
    return token && environment
      ? { environment, platform: "ios", provider: "apns", token }
      : null
  }
  if (Platform.OS === "android") {
    const token = await readJPushRegistrationID(true)
    return token
      ? {
          environment: "production",
          platform: "android",
          provider: "jpush",
          token,
        }
      : null
  }
  return null
}

async function readIOSDeviceToken() {
  const token = await Notifications.getDevicePushTokenAsync()
  return token.type === "ios" && typeof token.data === "string"
    ? token.data.trim()
    : ""
}

async function readPushEnvironment(): Promise<PushEnvironment | null> {
  const environment =
    await Application.getIosPushNotificationServiceEnvironmentAsync()
  return environment === "development" || environment === "production"
    ? environment
    : null
}

class PushLifecycleError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PushLifecycleError"
    this.code = code
  }
}

function privatePushRegistrationIsPermanentlyRejected(error: unknown) {
  return (
    error instanceof ApiRequestError &&
    (error.code === "push_disabled" || error.code === "grant_limit_reached")
  )
}
