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
  assert.match(formButton, /pressed \? palette\.backgroundPress : palette\.background/)
  assert.match(formButton, /pressed \? palette\.borderColorPress : palette\.borderColor/)
  assert.match(formButton, /light: \{[\s\S]*?gray: \{ color: "hsla\(0, 0%, 13%, 1\)"/)
  assert.match(formButton, /dark: \{[\s\S]*?gray: \{ color: "hsla\(0, 0%, 93%, 1\)"/)
  assert.doesNotMatch(formButton, /tamaguiConfig/)
  assert.match(formButton, /flexGrow: grow/)

  const voiceRecord = await source("features/conversation/voice/voice-record-button.tsx")
  assert.match(voiceRecord, /<Pressable[\s\S]*?onPressIn=\{onPressIn\}[\s\S]*?onPressOut=\{onPressOut\}[\s\S]*?pressRetentionOffset=/)
  const iconButton = await source("components/buttons/native-icon-button.tsx")
  assert.match(iconButton, /onLongPress=\{onLongPress\}/)
  assert.match(iconButton, /accessibilityState=\{\{ disabled \}\}/)
  assert.doesNotMatch(iconButton, /tamaguiConfig/)
  assert.match(iconButton, /colorScheme === "dark" \? colors\.background5 : colors\.background1/)
})

test("compact icon button uses XGUI colors for normal, pressed, and disabled states", async () => {
  const button = await source("components/buttons/compact-icon-button.tsx")
  assert.doesNotMatch(button, /from ["']tamagui["']/)
  assert.match(button, /disabled\s*\? colors\.textPlaceholder/)
  assert.match(button, /iconColor \?\?\s*\(pressed/)
  assert.match(button, /colorScheme === "dark"\s*\? colors\.brand2\s*: colors\.brand1\s*: colors\.brand5/)
  assert.match(button, /opacity=\{iconColor && pressed \? 0\.5 : 1\}/)
})
