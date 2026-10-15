import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const code = ts.transpileModule(readFileSync(new URL("../src/native/android-emoji-font-fallback.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function load(os: string, version = 35, nativeReady = true, registration = true) {
  const calls: unknown[][] = []
  const assets: string[] = []
  const native = {
    registerEmoji: (path: string) => { calls.push(["registerEmoji", path]); return registration },
    registerSystem: (family: string, path: string, weight: number) => { calls.push(["registerSystem", family, path, weight]); return registration },
    attachInput: (tag: number) => calls.push(["attach", tag]),
    detachInput: (tag: number) => calls.push(["detach", tag]),
  }
  const exports: Record<string, any> = {}
  runInNewContext(code, { exports, require(name: string) {
    if (name === "react-native") return { Platform: { OS: os, Version: version }, findNodeHandle: (input: { tag?: number }) => input.tag ?? null }
    if (name === "expo-modules-core") return { requireOptionalNativeModule: () => nativeReady ? native : null }
    if (name === "expo-asset") return { Asset: { fromModule: (path: string) => {
      assets.push(path)
      return { downloadAsync: async () => ({ localUri: "file:///test/emoji.ttf" }) }
    } } }
    if (name.endsWith(".ttf")) return name
    throw new Error(`unexpected import ${name}`)
  } })
  return { api: exports, calls, assets }
}

test("Android保留系统输入字体，仅加载一次表情素材并绑定/解绑原生片段", async () => {
  const { api, calls, assets } = load("android")
  assert.equal(api.getInputFontFamily("700"), undefined)
  const first = api.initializeInputEmojiFallback()
  assert.equal(first, api.initializeInputEmojiFallback())
  assert.equal(await first, true)
  assert.equal(api.getInputFontFamily("700"), undefined)
  assert.deepEqual(assets, ["../../assets/fonts/emoji/JiyingEmojiAndroid.ttf"])
  assert.equal(api.attachInputEmojiFallback(null), undefined)
  assert.equal(api.attachInputEmojiFallback({}), undefined)
  const detach = api.attachInputEmojiFallback({ tag: 123 })
  detach()
  assert.deepEqual(calls, [["registerEmoji", "file:///test/emoji.ttf"], ["attach", 123], ["detach", 123]])
})

test("iOS输入框以对应字重的系统字体为主，仅为表情添加级联", async () => {
  const { api, calls, assets } = load("ios")
  assert.equal(await api.initializeInputEmojiFallback(), true)
  assert.deepEqual(assets, ["../../assets/fonts/emoji/JiyingEmojiIOS.ttf"])
  assert.equal(calls.length, 9)
  for (const weight of [100, 200, 300, 400, 500, 600, 700, 800, 900]) {
    assert.equal(api.getInputFontFamily(String(weight)), `SystemEmojiFallback-${weight}`)
    assert.deepEqual(calls[weight / 100 - 1], ["registerSystem", `SystemEmojiFallback-${weight}`, "file:///test/emoji.ttf", weight])
  }
  assert.equal(api.getInputFontFamily(undefined), "SystemEmojiFallback-400")
  assert.equal(api.getInputFontFamily("bold"), "SystemEmojiFallback-700")
  assert.equal(api.getInputFontFamily("semibold"), "SystemEmojiFallback-600")
  assert.equal(api.attachInputEmojiFallback({ tag: 123 }), undefined)
})

test("旧Android、Web、缺少模块或注册失败时保留系统字体，不加载MiSans", async () => {
  for (const input of [load("android", 28), load("web"), load("android", 35, false), load("ios", 35, true, false), load("android", 35, true, false)]) {
    assert.equal(await input.api.initializeInputEmojiFallback(), false)
    assert.equal(input.api.getInputFontFamily("600"), undefined)
    assert.equal(input.api.attachInputEmojiFallback({ tag: 123 }), undefined)
    assert.ok(input.assets.every(path => !path.includes("MiSans")))
  }
})
