/// <reference types="node" />
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))

describe("emoji 字体来源与兼容入口", () => {
  it("Web 与 Desktop 固定使用相同版本的 Noto Color Emoji 包", () => {
    const web = JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8"))
    const desktop = JSON.parse(readFileSync(resolve(here, "../../../desktop/package.json"), "utf8"))
    expect(web.dependencies["@infolektuell/noto-color-emoji"]).toBe("0.2.0")
    expect(web.dependencies["@infolektuell/noto-color-emoji"]).toBe(desktop.devDependencies["@infolektuell/noto-color-emoji"])
  })

  it("正文、表情和代码字体均包含 Noto，并提供 Safari 同源 sbix 入口", () => {
    const css = readFileSync(resolve(here, "../index.css"), "utf8")
    expect(css).toContain('@import "@infolektuell/noto-color-emoji/index.css"')
    expect(css).toMatch(/--font-sans: [^;]*"Noto Color Emoji"/)
    expect(css).toMatch(/--font-mono: [^;]*"Noto Color Emoji"/)
    expect(css).toContain('--font-emoji: "Noto Color Emoji"')
    expect(css).toContain("@supports (font-tech(color-sbix)) and (not (font-tech(color-COLRv1)))")
    expect(css).toContain("../../../assets/fonts/noto-color-emoji/JiyingEmoji.ttf")
  })
})
