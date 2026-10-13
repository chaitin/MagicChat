import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8")
const stack = (name: string) => {
  const declaration = styles.match(new RegExp(`--font-${name}:([^;]+);`))?.[1]
  assert.ok(declaration, `缺少 ${name} 字体配置`)
  return declaration.split(",").map((family) => family.trim().replaceAll('"', ""))
}

test("普通文本优先 MiSans，Emoji 字体不接管数字", () => {
  for (const name of ["sans", "serif"]) {
    assert.deepEqual(stack(name).slice(0, 2), ["MiSans", "Noto Color Emoji"])
  }
})

test("等宽文本优先 JetBrains Mono，保留 Emoji 回退", () => {
  const fonts = stack("mono")
  assert.equal(fonts[0], "JetBrains Mono")
  assert.ok(fonts.includes("Noto Color Emoji"))
  assert.ok(fonts.indexOf("MiSans") < fonts.indexOf("Noto Color Emoji"))
})

test("专用 Emoji 字体栈仍优先使用 Noto Color Emoji", () => {
  assert.equal(stack("emoji")[0], "Noto Color Emoji")
})
