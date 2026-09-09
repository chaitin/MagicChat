export const PUSH_REMINDER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1_000

export type PushReminderKind = "consent" | "permission"

export type PushReminderRecord = {
  appVersion: string
  promptedAt: number
}

export type PushReminderState = {
  explicitlyDisabled: boolean
  prompts: Partial<Record<PushReminderKind, PushReminderRecord>>
  version: 1
}

export const EMPTY_PUSH_REMINDER_STATE: PushReminderState = {
  explicitlyDisabled: false,
  prompts: {},
  version: 1,
}

export function parsePushReminderState(value: unknown): PushReminderState | null {
  if (!isRecord(value) || value.version !== 1) return null
  const prompts = isRecord(value.prompts) ? value.prompts : {}
  const consent = parseReminderRecord(prompts.consent)
  const permission = parseReminderRecord(prompts.permission)
  return {
    explicitlyDisabled: value.explicitlyDisabled === true,
    prompts: {
      ...(consent ? { consent } : {}),
      ...(permission ? { permission } : {}),
    },
    version: 1,
  }
}

export function shouldShowPushReminder({
  appVersion,
  kind,
  now = Date.now(),
  state,
}: {
  appVersion: string
  kind: PushReminderKind
  now?: number
  state: PushReminderState
}) {
  if (state.explicitlyDisabled) return false
  const previous = state.prompts[kind]
  if (!previous || previous.appVersion !== appVersion) return true
  const elapsed = now - previous.promptedAt
  return elapsed >= PUSH_REMINDER_COOLDOWN_MS
}

export function recordPushReminder(
  state: PushReminderState,
  kind: PushReminderKind,
  appVersion: string,
  now = Date.now()
): PushReminderState {
  return {
    ...state,
    prompts: {
      ...state.prompts,
      [kind]: { appVersion, promptedAt: now },
    },
  }
}

export function clearPushReminder(
  state: PushReminderState,
  kind: PushReminderKind
): PushReminderState {
  if (!state.prompts[kind]) return state
  const prompts = { ...state.prompts }
  delete prompts[kind]
  return { ...state, prompts }
}

export function setPushReminderExplicitlyDisabled(
  state: PushReminderState,
  explicitlyDisabled: boolean
): PushReminderState {
  if (state.explicitlyDisabled === explicitlyDisabled) return state
  return { ...state, explicitlyDisabled }
}

function parseReminderRecord(value: unknown): PushReminderRecord | null {
  if (!isRecord(value)) return null
  if (
    typeof value.appVersion !== "string" ||
    !value.appVersion.trim() ||
    typeof value.promptedAt !== "number" ||
    !Number.isFinite(value.promptedAt) ||
    value.promptedAt < 0
  ) {
    return null
  }
  return {
    appVersion: value.appVersion.trim(),
    promptedAt: value.promptedAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
