import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { addRecentEmoji, emojiItems, normalizeRecentEmoji, RECENT_EMOJI_LIMIT } from "../src/features/conversation/composer/emoji-catalog.ts"

const mobileRoot = new URL("../", import.meta.url)

test("手机表情名单、标签和顺序与 Desktop 保持一致", async () => {
  const desktop = await readFile(new URL("../../desktop/src/renderer/features/chat/expression-picker-panel.tsx", import.meta.url), "utf8")
  const expressions = desktop.match(/const expressions = \[([\s\S]*?)\] as const/)
  assert.ok(expressions)
  const desktopItems = [...expressions[1].matchAll(/^\s*\["([^"]+)", "([^"]+)"\],?$/gm)]
    .map(([, value, label]) => [value, label])
  assert.equal(desktopItems.length, 80)
  assert.deepEqual(emojiItems, desktopItems)
})

test("最近使用只保留前十个有效表情、去重并将新选择置顶", () => {
  assert.deepEqual(normalizeRecentEmoji(null), [])
  assert.deepEqual(normalizeRecentEmoji(["🙃", "😄", 42, "😄", "😂", "❌"]), ["😄", "😂", "❌"])
  assert.equal(RECENT_EMOJI_LIMIT, 10)

  const initial = emojiItems.slice(0, 12).map(([value]) => value)
  assert.deepEqual(addRecentEmoji(initial, "❌"), ["❌", ...initial.slice(0, 9)])
  assert.deepEqual(addRecentEmoji(["😄", "😂"], "😂"), ["😂", "😄"])
})

test("手机面板最近使用和全部表情共用点击回调，保留连续插入", async () => {
  const accessory = await readFile(new URL("src/features/conversation/composer/composer-accessory-panel.tsx", mobileRoot), "utf8")
  assert.match(accessory, /AsyncStorage\.getItem\(recentStorageKey\)/)
  assert.match(accessory, /AsyncStorage\.setItem\(recentStorageKey/)
  assert.match(accessory, /label="最近使用" onSelect=\{selectEmoji\} values=\{recent\}/)
  assert.match(accessory, /label="所有表情"\s+onSelect=\{selectEmoji\}/)
  assert.match(accessory, /onPress=\{\(\) => onSelect\(value\)\}/)
  assert.match(accessory, /onEmojiPress\(value\)/)
})
