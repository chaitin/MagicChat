import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { splitEmojiText } from "../src/components/emoji-text-runs.ts"
import { emojiItems } from "../src/features/conversation/composer/emoji-catalog.ts"

const root = new URL("../", import.meta.url)

test("完整保留组合表情、肤色、旗帜与键帽，不改变消息文字", () => {
  const sequences = ["😵‍💫", "😮‍💨", "👍🏽", "👨‍👩‍👧‍👦", "🇨🇳", "1️⃣", "❤️", "☺️", "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}"]
  for (const value of [...sequences, ...emojiItems.map(([value]) => value)]) {
    const text = `文字${value}消息`
    const runs = splitEmojiText(text)
    assert.deepEqual(runs, [{ text: "文字", emoji: false }, { text: value, emoji: true }, { text: "消息", emoji: false }])
    assert.equal(runs.map((run) => run.text).join(""), text)
  }
  assert.deepEqual(splitEmojiText("中文 abc 123"), [{ text: "中文 abc 123", emoji: false }])
  assert.deepEqual(splitEmojiText("☺\uFE0E"), [{ text: "☺\uFE0E", emoji: false }])
  assert.deepEqual(splitEmojiText(""), [])
})

test("同源原生字体同时包含 Android 与 iOS 彩色位图及组合字形表", async () => {
  const font = await readFile(new URL("assets/fonts/emoji/JiyingEmoji.ttf", root))
  assert.equal(font.readUInt32BE(0), 0x00010000)
  const tags = new Set<string>()
  for (let i = 0; i < font.readUInt16BE(4); i++) tags.add(font.toString("ascii", 12 + i * 16, 16 + i * 16))
  for (const tag of ["CBDT", "CBLC", "sbix", "GSUB", "cmap"]) assert.ok(tags.has(tag), `missing ${tag}`)
  const layout = await readFile(new URL("src/app/_layout.tsx", root), "utf8")
  const text = await readFile(new URL("src/components/mi-sans-text.tsx", root), "utf8")
  const appInput = await readFile(new URL("src/components/forms/app-input.tsx", root), "utf8")
  const notices = await readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8")
  assert.match(layout, /JiyingEmoji: require\("\.\.\/\.\.\/assets\/fonts\/emoji\/JiyingEmoji\.ttf"\)/)
  assert.match(text, /fontFamily: "JiyingEmoji", fontWeight: "normal"/)
  const input = text.split("export const TextInput")[1]
  assert.match(input, /getInputFontFamily\(flattened\?\.fontWeight\)/)
  assert.doesNotMatch(layout + text, /MiSans/)
  assert.doesNotMatch(input, /fontFamily:[^\n]*"JiyingEmoji"/)
  const fallback = await readFile(new URL("src/native/android-emoji-font-fallback.ts", root), "utf8")
  assert.doesNotMatch(fallback, /Platform\.OS === "ios"\) return "JiyingEmoji"/)
  assert.match(fallback, /!ready \|\| Platform\.OS !== "ios"/)
  assert.match(fallback, /JiyingEmojiIOS\.ttf/)
  assert.match(fallback, /Platform\.OS === "android" && Number\(Platform\.Version\) >= 29/)
  assert.match(fallback, /SystemEmojiFallback-\$\{numeric\}/)
  assert.doesNotMatch(fallback, /MiSans/)
  assert.match(text, /splitEmojiText\(child\)/)
  assert.match(appInput, /@\/components\/mi-sans-text/)
  assert.match(notices, /共享 TextInput.*系统字体.*Android 9/)
  const android = await readFile(new URL("modules/font-fallback/android/src/main/java/cloud/baizhi/fontfallback/FontFallbackModule.kt", root), "utf8")
  const ios = await readFile(new URL("modules/font-fallback/ios/FontFallbackModule.swift", root), "utf8")
  assert.doesNotMatch(android + ios, /MiSans|CustomFallbackBuilder/)
  assert.match(android, /BreakIterator\.getCharacterInstance/)
  assert.match(android, /MetricAffectingSpan/)
  assert.match(android, /onPreDraw\(\)/)
  assert.match(android, /PasswordTransformationMethod/)
  assert.doesNotMatch(android, /text\.(replace|clear|append)\(|setSelection\(/)
  assert.match(ios, /UIFont\.systemFont\(ofSize:/)
  assert.match(ios, /CTFontCopyDefaultCascadeListForLanguages/)
  assert.match(ios, /kCTFontCascadeListAttribute: \[emojiDescriptor\] \+ systemCascade/)
})
