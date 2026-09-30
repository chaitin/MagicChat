import assert from "node:assert/strict"
import test from "node:test"
import {
  readDismissedUpdate,
  saveDismissedUpdate,
  shouldPromptForUpdate,
  updateVersionKey,
} from "../src/renderer/update-prompt.ts"
import type { UpdateInfo } from "../src/shared/desktop.ts"

const update: UpdateInfo = {
  platform: "macos",
  currentVersion: "2.0.0",
  currentBuildId: 20,
  latestVersion: "2.0.1",
  latestBuildId: 21,
  downloadUrl: "https://example.invalid/update.dmg",
  updateAvailable: true,
}

test("每小时自动检查对已暂缓的相同 Build 不重复弹窗，手动检查仍可查看", () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
  assert.equal(readDismissedUpdate(storage), null)
  assert.equal(shouldPromptForUpdate(update, false, null), true)
  saveDismissedUpdate(update, storage)
  const dismissedKey = readDismissedUpdate(storage)
  assert.equal(dismissedKey, updateVersionKey(update))
  assert.equal(shouldPromptForUpdate(update, false, dismissedKey), false)
  assert.equal(
    shouldPromptForUpdate(
      { ...update, downloadUrl: "https://example.invalid/new.dmg" },
      false,
      dismissedKey,
    ),
    false,
  )
  assert.equal(shouldPromptForUpdate(update, true, dismissedKey), true)
  assert.equal(shouldPromptForUpdate({ ...update, latestBuildId: 22 }, false, dismissedKey), true)
  assert.equal(shouldPromptForUpdate({ ...update, platform: "windows" }, false, dismissedKey), true)
  assert.equal(
    shouldPromptForUpdate({ ...update, updateAvailable: false }, true, dismissedKey),
    false,
  )
})

test("本地存储不可用时读取和写入暂缓记录不会阻止更新检查", () => {
  const storage = {
    getItem: (): string | null => {
      throw new Error("unavailable")
    },
    setItem: (): void => {
      throw new Error("unavailable")
    },
  }
  assert.equal(readDismissedUpdate(storage), null)
  assert.doesNotThrow(() => saveDismissedUpdate(update, storage))
})
