import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../", import.meta.url)
const fonts = [
  ["JetBrainsMono", "Regular", 400, false, "a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f"],
  ["JetBrainsMono-SemiBold", "SemiBold", 600, false, "1b3bfa1ed5665a4ce3f9feb68d2d4e40e70bf8b4b7d9a3edd418f321b4e166a0"],
  ["JetBrainsMono-Italic", "Italic", 400, true, "9d0a1f7a708e6af183f1193b7e81d40da294f5c67682c085d8401c60aac8ded4"],
  ["JetBrainsMono-SemiBoldItalic", "SemiBoldItalic", 600, true, "3b3000507a7285872395ddbb4e53a28f07910dbf494fb0d5e1421dd60b5d8436"],
] as const

function table(font: Buffer, tag: string) {
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const offset = 12 + index * 16
    if (font.toString("ascii", offset, offset + 4) === tag) return font.readUInt32BE(offset + 8)
  }
  throw new Error(`缺少字体表 ${tag}`)
}

test("JetBrains Mono使用固定官方TTF，文件哈希、实际字重与斜体信息正确，附带OFL授权", () => {
  const notices = readFileSync(new URL("THIRD_PARTY_NOTICES.md", root), "utf8")
  const license = readFileSync(new URL("assets/fonts/jetbrains-mono/OFL.txt", root), "utf8")
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/)
  assert.match(license, /JetBrains Mono Project Authors/)
  for (const [, face, weight, italic, sha] of fonts) {
    const font = readFileSync(new URL(`assets/fonts/jetbrains-mono/JetBrainsMono-${face}.ttf`, root))
    assert.equal(font.readUInt32BE(0), 0x00010000)
    assert.equal(createHash("sha256").update(font).digest("hex"), sha)
    assert.equal(font.readUInt16BE(table(font, "OS/2") + 4), weight)
    assert.equal(font.readInt32BE(table(font, "post") + 4) !== 0, italic)
    assert.ok(table(font, "cmap") > 0)
    assert.ok(notices.includes(sha))
  }
})

test("所有代码字形沿用启动加载机制，Emoji仍单独加载，界面正文不改字体", () => {
  const layout = readFileSync(new URL("src/app/_layout.tsx", root), "utf8")
  for (const [alias, face] of fonts) {
    const key = alias === "JetBrainsMono" ? alias : `"${alias}"`
    assert.ok(layout.includes(`${key}: require("../../assets/fonts/jetbrains-mono/JetBrainsMono-${face}.ttf")`))
  }
  assert.match(layout, /JiyingEmoji: require/)
  assert.match(layout, /fontsReady \? <Stack/)
  const text = readFileSync(new URL("src/components/mi-sans-text.tsx", root), "utf8")
  assert.doesNotMatch(text, /JetBrainsMono/)
  assert.match(text, /fontFamily: "JiyingEmoji"/)
})
