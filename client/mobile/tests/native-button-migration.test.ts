import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")

const buttonFiles = [
  "components/buttons/compact-icon-button.tsx",
  "components/buttons/native-icon-button.tsx",
  "components/forms/app-button.tsx",
  "components/forms/password-input.tsx",
  "components/navigation/header-button.tsx",
  "components/navigation/page-header.tsx",
  "features/conversation/composer/composer-accessory-panel.tsx",
  "features/conversation/messages/message-body.tsx",
  "features/conversation/messages/message-bubble.tsx",
  "features/conversation/voice/voice-message-player.tsx",
  "features/conversation/voice/voice-record-button.tsx",
  "features/conversation/voice/voice-recording-preview-button.tsx",
]

test("mobile buttons use native press targets instead of Tamagui Button", async () => {
  for (const file of buttonFiles) {
    const content = await source(file)
    assert.doesNotMatch(content, /\bButton\s*,?\s*(?:type\s+\w+\s*,?\s*)?\}\s*from\s*["']tamagui["']|<Button\b/, file)
  }

  const formButton = await source("components/forms/app-button.tsx")
  assert.match(formButton, /<Pressable[\s\S]*?accessibilityRole="button"[\s\S]*?disabled=\{disabled\}[\s\S]*?onPress=\{onPress\}/)
  assert.match(formButton, /palette\.backgroundPress\.val/)
  assert.match(formButton, /palette\.borderColor\.val/)
  assert.match(formButton, /flexGrow: grow/)

  const voiceRecord = await source("features/conversation/voice/voice-record-button.tsx")
  assert.match(voiceRecord, /<Pressable[\s\S]*?onPressIn=\{onPressIn\}[\s\S]*?onPressOut=\{onPressOut\}[\s\S]*?pressRetentionOffset=/)
  const iconButton = await source("components/buttons/native-icon-button.tsx")
  assert.match(iconButton, /onLongPress=\{onLongPress\}/)
  assert.match(iconButton, /accessibilityState=\{\{ disabled \}\}/)
})
