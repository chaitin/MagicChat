import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
} from "../src/shared/desktop.ts"

test("首次安装三个通知选项均默认开启", () => {
  assert.deepEqual(DEFAULT_NOTIFICATION_SETTINGS, {
    soundEnabled: true,
    desktopEnabled: true,
    showMessagePreview: true,
  })
})

test("旧配置继续隐藏消息内容并保留已有开关", () => {
  assert.deepEqual(normalizeNotificationSettings(undefined), {
    soundEnabled: true,
    desktopEnabled: true,
    showMessagePreview: false,
  })
  assert.deepEqual(normalizeNotificationSettings({ soundEnabled: false, desktopEnabled: true }), {
    soundEnabled: false,
    desktopEnabled: true,
    showMessagePreview: false,
  })
  assert.deepEqual(
    normalizeNotificationSettings({
      soundEnabled: true,
      desktopEnabled: true,
      showMessagePreview: true,
    }),
    {
      soundEnabled: true,
      desktopEnabled: true,
      showMessagePreview: true,
    },
  )
})
