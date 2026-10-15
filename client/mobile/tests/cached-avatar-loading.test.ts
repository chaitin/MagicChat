import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { getAvatarFormatHint, isSvgContent } from "@/components/avatar/avatar-resource-format"

const source = readFileSync(new URL("../src/components/avatar/cached-avatar-image.tsx", import.meta.url), "utf8")
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function renderer(format?: boolean, content = "not-svg") {
  let cursor = 0, fileReads = 0
  let effects: (() => void)[] = []
  const slots: any[] = []
  const formats = new Map<string, boolean>()
  if (format !== undefined) formats.set("file:///cache/avatar.image", format)
  const exports: Record<string, any> = {}
  runInNewContext(`${code}\nexports.components = { CachedAvatarResource, RetryableAvatarImage, RetryableSvgImage };`, {
    exports,
    require(name: string) {
      if (name === "react") return {
        useCallback: (fn: Function) => fn,
        useEffect: (effect: () => void) => effects.push(effect),
        useRef(value: unknown) { const index = cursor++; slots[index] ??= { current: value }; return slots[index] },
        useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value }] },
      }
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }), Fragment: "Fragment" }
      if (name === "react-native") return { Image: "Image", View: "View", Platform: { OS: "android" }, StyleSheet: { absoluteFill: "absolute-fill" } }
      if (name === "react-native-svg") return { SvgXml: "SvgXml" }
      if (name === "expo-file-system/legacy") return { EncodingType: { UTF8: "utf8" }, readAsStringAsync: async () => { fileReads++; return content } }
      if (name === "@/components/avatar/avatar-resource-format") return { getAvatarFormatHint, isSvgContent }
      if (name === "@/components/avatar/avatar-render-cache") return { getCachedAvatarFormat: (uri: string) => formats.get(uri), setCachedAvatarFormat: (uri: string, value: boolean) => formats.set(uri, value), getCachedAvatarSvg: () => undefined }
      if (name === "@/data/resources") return { useCachedAvatar: () => ({ uri: "", isLoading: true, error: null }) }
      if (name === "@/xgui") return { useXGUITheme: () => ({ colors: { background1: "placeholder" } }) }
      throw new Error(`unexpected import ${name}`)
    },
  })
  return {
    api: exports, components: exports.components,
    render(component: Function, props: unknown) { cursor = 0; effects = []; return component(props) },
    effects: () => effects.forEach((effect) => effect()),
    fileReads: () => fileReads,
  }
}

const properties = { server: { id: "server", url: "https://example.test" }, avatar: "/avatar", refetch: async () => ({}), sourceUrl: "https://example.test/avatar", uri: "file:///cache/avatar.image" }

test("缓存URI等待期间不覆盖普通或九宫格头像的兜底图", () => {
  const view = renderer()
  assert.equal(view.render(view.api.CachedAvatarImage, properties), null)
  assert.equal(view.render(view.api.CachedAvatarTileImage, properties), null)
})

test("已知栅格头像在首帧直接交给原生图片，不读取二进制为UTF8", () => {
  const view = renderer()
  const node = view.render(view.components.CachedAvatarResource, { ...properties, uri: "file:///cache/avatar.webp" })
  assert.equal(node.type, view.components.RetryableAvatarImage)
  view.effects()
  assert.equal(view.fileReads(), 0)
})

test("已识别的无扩展名头像不在每次挂载时重复读取", () => {
  const view = renderer(false)
  const node = view.render(view.components.CachedAvatarResource, properties)
  assert.equal(node.type, view.components.RetryableAvatarImage)
  view.effects()
  assert.equal(view.fileReads(), 0)
})

test("未知格式仍异步识别，但不遮挡兜底头像", async () => {
  const view = renderer()
  assert.equal(view.render(view.components.CachedAvatarResource, properties), null)
  view.effects()
  assert.equal(view.fileReads(), 1)
  await flush()
  assert.equal(view.render(view.components.CachedAvatarResource, properties).type, view.components.RetryableAvatarImage)
})

test("原生图片解码完成前背景透明，加载完成后保留原有底色", () => {
  const view = renderer()
  let node = view.render(view.components.RetryableAvatarImage, properties)
  assert.equal(node.type, "Image")
  assert.equal(node.props.style[1], undefined)
  node.props.onLoad()
  node = view.render(view.components.RetryableAvatarImage, properties)
  assert.equal(node.props.style[1].backgroundColor, "placeholder")
})

test("扩展名不准确时，在原生解码失败后复核内容，仍可展示SVG", async () => {
  const view = renderer(undefined, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  const props = { ...properties, uri: "file:///cache/avatar.png" }
  const native = view.render(view.components.CachedAvatarResource, props)
  assert.equal(native.type, view.components.RetryableAvatarImage)
  await native.props.refetch()
  assert.equal(view.render(view.components.CachedAvatarResource, props), null)
  view.effects()
  await flush()
  assert.equal(view.render(view.components.CachedAvatarResource, props).type, view.components.RetryableSvgImage)
})

test("原生图片重试时恢复透明背景，最终失败仍展示兜底", async () => {
  const view = renderer()
  let node = view.render(view.components.RetryableAvatarImage, properties)
  node.props.onLoad()
  node = view.render(view.components.RetryableAvatarImage, properties)
  node.props.onError()
  await flush()
  node = view.render(view.components.RetryableAvatarImage, properties)
  assert.equal(node.props.style[1], undefined)
  node.props.onError()
  assert.equal(view.render(view.components.RetryableAvatarImage, properties), null)
})

test("SVG正文加载前也保留兜底，不渲染空白遮罩", () => {
  const view = renderer()
  assert.equal(view.render(view.components.RetryableSvgImage, properties), null)
})
