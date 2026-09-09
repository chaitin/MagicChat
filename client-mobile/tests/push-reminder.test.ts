import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  clearPushReminder,
  EMPTY_PUSH_REMINDER_STATE,
  parsePushReminderState,
  PUSH_REMINDER_COOLDOWN_MS,
  recordPushReminder,
  setPushReminderExplicitlyDisabled,
  shouldShowPushReminder,
} from "@/notifications/push-reminder"

const NOW = Date.parse("2026-09-09T00:00:00Z")

test("push reminder appears initially and cools down for the same version", () => {
  assert.equal(
    shouldShowPushReminder({
      appVersion: "1.4.1",
      kind: "consent",
      now: NOW,
      state: EMPTY_PUSH_REMINDER_STATE,
    }),
    true
  )

  const prompted = recordPushReminder(
    EMPTY_PUSH_REMINDER_STATE,
    "consent",
    "1.4.1",
    NOW
  )
  assert.equal(
    shouldShowPushReminder({
      appVersion: "1.4.1",
      kind: "consent",
      now: NOW + PUSH_REMINDER_COOLDOWN_MS - 1,
      state: prompted,
    }),
    false
  )
  assert.equal(
    shouldShowPushReminder({
      appVersion: "1.4.1",
      kind: "consent",
      now: NOW + PUSH_REMINDER_COOLDOWN_MS,
      state: prompted,
    }),
    true
  )
})

test("a new app version can remind again while an explicit disable remains respected", () => {
  const prompted = recordPushReminder(
    EMPTY_PUSH_REMINDER_STATE,
    "permission",
    "1.4.1",
    NOW
  )
  assert.equal(
    shouldShowPushReminder({
      appVersion: "1.4.2",
      kind: "permission",
      now: NOW + 1,
      state: prompted,
    }),
    true
  )

  const disabled = setPushReminderExplicitlyDisabled(prompted, true)
  assert.equal(
    shouldShowPushReminder({
      appVersion: "1.4.2",
      kind: "permission",
      now: NOW + PUSH_REMINDER_COOLDOWN_MS,
      state: disabled,
    }),
    false
  )
})

test("mobile lifecycle installs the reminder and checks Android message channels", async () => {
  const [provider, notifications, reminder, settings] = await Promise.all([
    readFile(
      new URL("../src/providers/push-provider.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/notifications/message-notifications.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/notifications/use-push-reminder.tsx", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../src/features/me/me-screen.tsx", import.meta.url),
      "utf8"
    ),
  ])
  assert.match(provider, /<PushReminderDialog \/>/)
  assert.match(provider, /AppState\.addEventListener/)
  assert.match(notifications, /getNotificationChannelAsync/)
  assert.match(notifications, /AndroidImportance\.NONE/)
  assert.match(reminder, /<XGUIDialog/)
  assert.doesNotMatch(reminder, /Alert\.alert/)
  assert.match(settings, /<XGUIDialog/)
  assert.match(settings, /setPushReminderExplicitlyDisabled\(current, true\)/)
})

test("reminder records parse defensively and can be cleared independently", () => {
  const parsed = parsePushReminderState({
    explicitlyDisabled: false,
    prompts: {
      consent: { appVersion: " 1.4.1 ", promptedAt: NOW },
           permission: { appVersion: "", promptedAt: -1 },
    },
    version: 1,
  })
  assert.deepEqual(parsed, {
    explicitlyDisabled: false,
    prompts: {
      consent: { appVersion: "1.4.1", promptedAt: NOW },
    },
    version: 1,
  })
  assert.deepEqual(clearPushReminder(parsed!, "consent").prompts, {})
  assert.equal(parsePushReminderState({ version: 2 }), null)
})
