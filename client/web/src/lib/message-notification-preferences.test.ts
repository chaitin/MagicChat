import { beforeEach, describe, expect, it } from "vitest"

import {
  isBrowserMessageNotificationEnabled,
  isMessageNotificationSoundEnabled,
  setBrowserMessageNotificationEnabled,
  setMessageNotificationSoundEnabled,
} from "@/lib/message-notification-preferences"

describe("message notification preferences", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("defaults to enabled", () => {
    expect(isBrowserMessageNotificationEnabled()).toBe(true)
    expect(isMessageNotificationSoundEnabled()).toBe(true)
  })

  it("persists the browser notification preference", () => {
    setBrowserMessageNotificationEnabled(false)
    expect(isBrowserMessageNotificationEnabled()).toBe(false)

    setBrowserMessageNotificationEnabled(true)
    expect(isBrowserMessageNotificationEnabled()).toBe(true)
  })

  it("persists the sound preference", () => {
    setMessageNotificationSoundEnabled(false)
    expect(isMessageNotificationSoundEnabled()).toBe(false)

    setMessageNotificationSoundEnabled(true)
    expect(isMessageNotificationSoundEnabled()).toBe(true)
  })
})
