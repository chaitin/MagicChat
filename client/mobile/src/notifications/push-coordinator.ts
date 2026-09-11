import { SerializedOperationQueue } from "@/notifications/serialized-operation-queue"
import {
  getPushRetryDelay,
  PUSH_REGISTRATION_REFRESH_MS,
  pushSynchronizationShouldRetry,
  targetsMatch,
  type PushAccountIdentity,
} from "@/notifications/push-types"

export type PushSynchronizationState =
  | "idle"
  | "synchronizing"
  | "registered"
  | "permission_denied"
  | "consent_required"
  | "user_disabled"
  | "provider_unavailable"
  | "temporarily_unavailable"
  | "server_disabled"
  | "device_limit_reached"
  | "unauthorized"

export type PushCoordinatorOperations = {
  deactivate: (identity?: PushAccountIdentity) => Promise<void>
  flushPendingRevocation: () => Promise<void>
  getInstallationId: (
    identity: PushAccountIdentity
  ) => Promise<string | undefined>
  queueRevocation: (identity: PushAccountIdentity, privateRevoked?: boolean) => Promise<void>
  synchronize: (
    identity: PushAccountIdentity,
    options: { deviceToken?: string }
  ) => Promise<boolean>
}

type PushCoordinatorOptions = {
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  refreshDelay?: number
  retryDelay?: (attempt: number) => number
  setTimer?: (
    callback: () => void,
    delay: number
  ) => ReturnType<typeof setTimeout>
}

export class PushCoordinator {
  private readonly clearTimer: NonNullable<PushCoordinatorOptions["clearTimer"]>
  private enabled = false
  private generation = 0
  private readonly listeners = new Set<() => void>()
  private readonly operations: PushCoordinatorOperations
  private readonly queue = new SerializedOperationQueue()
  private pendingDeviceToken = ""
  private readonly refreshDelay: number
  private retryAttempt = 0
  private readonly retryDelay: (attempt: number) => number
  private readonly setTimer: NonNullable<PushCoordinatorOptions["setTimer"]>
  private state: PushSynchronizationState = "idle"
  private identity: PushAccountIdentity | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    operations: PushCoordinatorOperations,
    options: PushCoordinatorOptions = {}
  ) {
    this.operations = operations
    this.clearTimer = options.clearTimer ?? clearTimeout
    this.refreshDelay = options.refreshDelay ?? PUSH_REGISTRATION_REFRESH_MS
    this.retryDelay = options.retryDelay ?? getPushRetryDelay
    this.setTimer = options.setTimer ?? setTimeout
  }

  getState() {
    return this.state
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  configure({
    enabled,
    identity,
  }: {
    enabled: boolean
    identity: PushAccountIdentity | null
  }) {
    const unchanged =
      this.enabled === enabled && identitiesEqual(this.identity, identity)
    if (unchanged) return false

    this.enabled = enabled
    const previous = this.identity
    this.identity = identity
    this.cancelScheduledOperation()
    this.retryAttempt = 0
    if (!enabled) {
      this.setState("idle")
      return true
    }
    this.startCurrentOperation(previous)
    return true
  }

  pause() {
    this.configure({ enabled: false, identity: null })
  }

  triggerSynchronization(deviceToken?: string) {
    const normalizedToken = deviceToken?.trim()
    if (normalizedToken) this.pendingDeviceToken = normalizedToken
    if (!this.enabled) return
    this.cancelScheduledOperation()
    this.startCurrentOperation()
  }

  getInstallationId(identity: PushAccountIdentity) {
    return this.queue.run(() => this.operations.getInstallationId(identity))
  }

  queueRevocation(identity: PushAccountIdentity, privateRevoked = false) {
    return this.queue.run(() => this.operations.queueRevocation(identity, privateRevoked))
  }

  deactivate(identity?: PushAccountIdentity) {
    return this.queue.run(() => this.operations.deactivate(identity))
  }

  dispose() {
    this.pause()
    this.listeners.clear()
  }

  private startCurrentOperation(previous: PushAccountIdentity | null = null) {
    const identity = this.identity
    if (identity) {
      this.startSynchronization(identity, previous)
    } else {
      this.startPendingRevocationFlush()
    }
  }

  private startSynchronization(identity: PushAccountIdentity, previous: PushAccountIdentity | null = null) {
    const generation = ++this.generation
    const deviceToken = this.pendingDeviceToken
    this.setState("synchronizing")
    void this.queue
      .run(() =>
        (async () => {
          if (previous && !identitiesEqual(previous, identity)) {
            try { await this.operations.deactivate(previous) }
            catch { await this.operations.queueRevocation(previous) }
          }
          await this.operations.flushPendingRevocation().catch(() => undefined)
          return this.operations.synchronize(identity, {
            deviceToken: deviceToken || undefined,
          })
        })()
      )
      .then((registered) => {
        if (!this.isCurrent(generation, identity)) return
        this.retryAttempt = 0
        if (this.pendingDeviceToken === deviceToken) {
          this.pendingDeviceToken = ""
        }
        if (!registered) {
          this.setState("permission_denied")
          return
        }
        this.setState("registered")
        this.schedule(() => this.startSynchronization(identity), this.refreshDelay)
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(generation, identity)) return
        this.setState(classifyPushSynchronizationError(error))
        if (!pushSynchronizationShouldRetry(error)) return
        const delay = this.retryDelay(this.retryAttempt)
        this.retryAttempt += 1
        this.schedule(() => this.startSynchronization(identity), delay)
      })
  }

  private startPendingRevocationFlush() {
    const generation = ++this.generation
    void this.queue
      .run(() => this.operations.flushPendingRevocation())
      .then(() => {
        if (!this.isCurrent(generation, null)) return
        this.retryAttempt = 0
        this.setState("idle")
      })
      .catch(() => {
        if (!this.isCurrent(generation, null)) return
        this.setState("temporarily_unavailable")
        const delay = this.retryDelay(this.retryAttempt)
        this.retryAttempt += 1
        this.schedule(() => this.startPendingRevocationFlush(), delay)
      })
  }

  private schedule(operation: () => void, delay: number) {
    this.timer = this.setTimer(() => {
      this.timer = undefined
      operation()
    }, delay)
  }

  private cancelScheduledOperation() {
    this.generation += 1
    if (this.timer !== undefined) {
      this.clearTimer(this.timer)
      this.timer = undefined
    }
  }

  private isCurrent(
    generation: number,
    identity: PushAccountIdentity | null
  ) {
    return (
      this.enabled &&
      generation === this.generation &&
      identitiesEqual(this.identity, identity)
    )
  }

  private setState(state: PushSynchronizationState) {
    if (this.state === state) return
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

export function classifyPushSynchronizationError(
  error: unknown
): PushSynchronizationState {
  const code = readErrorCode(error)
  if (code === "jpush_consent_required") return "consent_required"
  if (code === "push_user_disabled") return "user_disabled"
  if (
    code === "android_provider_unavailable" ||
    code === "unsupported_provider"
  ) {
    return "provider_unavailable"
  }
  if (code === "push_disabled") return "server_disabled"
  if (code === "grant_limit_reached") return "device_limit_reached"
  if (code === "unauthorized") return "unauthorized"
  return "temporarily_unavailable"
}

function identitiesEqual(
  first: PushAccountIdentity | null,
  second: PushAccountIdentity | null
) {
  if (!first || !second) return first === second
  return first.accountId === second.accountId && first.generation === second.generation && targetsMatch(first.target, second.target)
}

function readErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return ""
  }
  return typeof error.code === "string" ? error.code : ""
}
