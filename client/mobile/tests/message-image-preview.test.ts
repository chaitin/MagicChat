import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = readFileSync(new URL(
  "../src/features/conversation/messages/message-body.tsx",
  import.meta.url
), "utf8")
const ast = ts.createSourceFile("message-body.tsx", source, ts.ScriptTarget.Latest, true)
const names = ["MessageImageThumbnail", "LoadedMessageImage", "MessageImageStatus"]
const declarations = ast.statements.filter((node) =>
  ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")
)
assert.equal(declarations.length, names.length)
const code = ts.transpileModule(
  declarations.map((node) => `export ${node.getText(ast)}`).join("\n"),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

function renderer() {
  let cursor = 0
  let slots: any[] = []
  const hookSlots = new Map<Function, any[]>()
  const decoded = new Set<string>()
  const exports: Record<string, any> = {}
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  runInNewContext(code, {
    exports,
    require(name: string) {
      assert.equal(name, "react/jsx-runtime")
      return { jsx, jsxs: jsx }
    },
    Pressable: "Pressable",
    Image: "Image",
    useRef(value: unknown) {
      const index = cursor++
      slots[index] ??= { current: value }
      return slots[index]
    },
    useState(initial: unknown) {
      const stateSlots = slots
      const index = cursor++
      if (!(index in stateSlots)) {
        stateSlots[index] = typeof initial === "function" ? initial() : initial
      }
      return [stateSlots[index], (value: unknown) => {
        stateSlots[index] = typeof value === "function" ? value(stateSlots[index]) : value
      }]
    },
    useXGUITheme: () => ({ colors: { background4: "placeholder" } }),
    hasLoadedAttachmentImage: (uri: string) => decoded.has(uri),
    markAttachmentImageLoaded: (uri: string) => decoded.add(uri),
    forgetLoadedAttachmentImage: (uri: string) => decoded.delete(uri),
  })
  return {
    components: exports,
    decoded,
    render(component: Function, props: unknown) {
      cursor = 0
      slots = hookSlots.get(component) ?? []
      hookSlots.set(component, slots)
      return component(props)
    },
  }
}

const uri = "file:///cache/chat-image.png"
const properties = {
  captioned: false,
  onError() {},
  onLongPress() {},
  onPress() {},
  size: { height: 120, width: 160 },
}

for (const status of ["missing", "idle", "loading", "error"] as const) {
  test(`${status} 图片占位可直接打开预览`, () => {
    const view = renderer()
    let opened = 0
    const node = view.render(view.components.MessageImageThumbnail, {
      ...properties,
      onPress: () => { opened++ },
      state: status === "missing" ? undefined : { status, resource: null },
    })
    assert.equal(node.type, view.components.MessageImageStatus)
    const placeholder = view.render(node.type, node.props)
    assert.notEqual(placeholder.props.disabled, true)
    assert.equal(placeholder.props.accessibilityRole, "button")
    assert.equal(placeholder.props.pointerEvents, "auto")
    placeholder.props.onPressIn()
    placeholder.props.onPress()
    assert.equal(opened, 1)
  })
}

test("图片已下载但尚未解码时可预览，加载遮罩不拦截外层点击或长按", () => {
  const view = renderer()
  let opened = 0
  const thumbnail = view.render(view.components.MessageImageThumbnail, {
    ...properties,
    onPress: () => { opened++ },
    state: { status: "ready", resource: { uri } },
  })
  assert.equal(thumbnail.type, view.components.LoadedMessageImage)
  const node = view.render(thumbnail.type, thumbnail.props)
  assert.notEqual(node.props.disabled, true)
  assert.equal(node.props.accessibilityLabel, "查看图片")
  assert.equal(node.props.children[0].props.style.opacity, 0)
  const overlay = node.props.children[1]
  const mask = view.render(overlay.type, overlay.props)
  assert.equal(mask.props.pointerEvents, "none")
  assert.equal(mask.props.accessible, false)
  node.props.onPressIn()
  node.props.onPress()
  assert.equal(opened, 1)
})

for (const name of ["MessageImageStatus", "LoadedMessageImage"]) {
  test(`${name} 长按只打开菜单，下一次短按仍能打开预览`, () => {
    const view = renderer()
    let opened = 0, menus = 0
    const node = view.render(view.components[name], {
      ...properties,
      uri,
      error: false,
      onPress: () => { opened++ },
      onLongPress: () => { menus++ },
    })
    node.props.onPressIn()
    node.props.onLongPress()
    node.props.onPress()
    assert.equal(menus, 1)
    assert.equal(opened, 0)
    node.props.onPressIn()
    node.props.onPress()
    assert.equal(opened, 1)
  })
}

test("原生图片加载成功和失败后均可预览，解码缓存和错误回调保持有效", () => {
  const view = renderer()
  let opened = 0, errors = 0
  const props = {
    ...properties,
    uri,
    onPress: () => { opened++ },
    onError: () => { errors++ },
  }
  let node = view.render(view.components.LoadedMessageImage, props)
  node.props.children[0].props.onLoad()
  assert.equal(view.decoded.has(uri), true)
  node = view.render(view.components.LoadedMessageImage, props)
  assert.equal(node.props.children[0].props.style.opacity, 1)
  node.props.onPress()
  node.props.children[0].props.onError()
  assert.equal(view.decoded.has(uri), false)
  assert.equal(errors, 1)
  node = view.render(view.components.LoadedMessageImage, props)
  assert.notEqual(node.props.disabled, true)
  assert.equal(node.props.children[0].props.style.opacity, 0)
  const mask = view.render(node.props.children[1].type, node.props.children[1].props)
  assert.equal(mask.props.pointerEvents, "none")
  node.props.onPress()
  assert.equal(opened, 2)
})

test("已解码的缓存图片首帧仍可显示并打开预览", () => {
  const view = renderer()
  view.decoded.add(uri)
  let opened = 0
  const node = view.render(view.components.LoadedMessageImage, {
    ...properties,
    uri,
    onPress: () => { opened++ },
  })
  assert.equal(node.props.children[0].props.style.opacity, 1)
  assert.notEqual(node.props.disabled, true)
  node.props.onPress()
  assert.equal(opened, 1)
})
