import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

type Element = { type: string; props: Record<string, any>; children: any[] }
const React = { createElement: (type: string, props: Record<string, any>, ...children: any[]): Element => ({ type, props: props ?? {}, children }) }
const source = (name: string) => readFileSync(new URL(`../src/features/conversation/messages/${name}`, import.meta.url), "utf8")
function load(name: string, globals: Record<string, unknown>) {
  const ast = ts.createSourceFile(name, source(name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const code = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n")
  const exports: any = {}
  runInNewContext(ts.transpileModule(code, {
    fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, { exports, React, ...globals })
  return exports
}
function find(node: Element, type: string): Element | undefined {
  if (node.type === type) return node
  for (const child of node.children.flat()) {
    if (child && typeof child === "object") { const result = find(child, type); if (result) return result }
  }
}
function parentOf(root: Element, target: Element): Element | undefined {
  if (root.children.includes(target)) return root
  for (const child of root.children.flat()) {
    if (child && typeof child === "object") { const result = parentOf(child, target); if (result) return result }
  }
}

function bubbleRenderer() {
  return load("message-bubble.tsx", {
    memo: (component: unknown) => component, useRef: (current: unknown) => ({ current }),
    useXGUITheme: () => ({ colors: { brand1: "mine-bg", background2: "other-bg", textPlaceholder: "muted", foreground5: "pressed-bg", brand: "brand", separator: "separator" } }),
    View: "View", Text: "Text", Pressable: "Pressable", AppAvatar: "Avatar",
    MessageBody: "MessageBody", MessageChoice: "MessageChoice", MessageHighlightOutline: "Outline",
    MessageReactionChips: "Reactions", TopicReplyPreview: "Topic", XGUILoadingIcon: "Loading", IconAlertCircleFilled: "Error",
    formatClientMessageBodySummary: () => "系统消息",
  }).MessageBubble
}

function message(role: string, type = "text") {
  return {
    id: "message", role, author: "Alice", avatar: "", body: { type, content: "正文", fileId: "file" },
    reactions: [], sender: { id: "alice", type: "user" }, canRevoke: false,
  }
}
const props = { currentUserId: "me", server: { url: "https://example.test" }, resourceStates: new Map(), resolveMentionLabel: () => undefined }

test("普通、图片及结构化气泡只在气泡外侧绘制轮廓，头像和名称所在整行不再铺色", () => {
  const render = bubbleRenderer()
  for (const role of ["me", "other"]) {
    for (const type of ["text", "image", "video", "card", "choice"]) {
      const tree: Element = render({ ...props, message: message(role, type), highlighted: true, highlightRequestKey: 3 })
      assert.equal(tree.props.style.backgroundColor, undefined)
      const outline = find(tree, "Outline")!
      assert.ok(outline)
      assert.equal(outline.props.key, 3)
      const frame = parentOf(tree, outline)!
      assert.notEqual(frame, tree)
      assert.equal(frame.props.style.position, "relative")
      assert.equal(frame.props.style.overflow, undefined)
      const bubble = frame.children.find((child) => child?.props?.style?.overflow === "hidden")
      assert.ok(bubble, "保留内容气泡的裁切规则，轮廓作为同级视图不被图片裁切")
      assert.equal(bubble.props.style.backgroundColor, role === "me" ? "mine-bg" : "other-bg")
      assert.equal(outline.props.style.borderTopLeftRadius, role === "me" ? 12 : 5)
      assert.equal(outline.props.style.borderTopRightRadius, role === "me" ? 5 : 12)
      assert.equal(frame.props.nativeID?.includes("magicchat-message"), type === "text" ? true : undefined)
    }
  }
})

test("引用按住时显示淡背景和品牌色竖线，松开恢复，禁用状态不展示按压反馈", () => {
  const render = bubbleRenderer()
  for (const role of ["me", "other"]) {
    for (const enabled of [true, false]) {
      for (const hasHandler of [true, false]) {
        const tree: Element = render({
          ...props, message: { ...message(role), replyTo: { id: "original", author: "Alice", summary: "原消息" } },
          messageActionsEnabled: enabled, onLocateReplyMessage: hasHandler ? () => {} : undefined,
        })
        const content = parentOf(tree, find(tree, "MessageBody")!)!
        const reference = content.children.find((child) => child?.props?.accessibilityLabel === "定位被引用的原消息")!
        const idle = reference.props.style({ pressed: false })
        const pressed = reference.props.style({ pressed: true })
        assert.equal(reference.props.disabled, !(enabled && hasHandler))
        assert.equal(idle.backgroundColor, undefined)
        assert.equal(pressed.backgroundColor, enabled && hasHandler ? "pressed-bg" : undefined)
        assert.equal(idle.borderLeftWidth, undefined)
        assert.equal(pressed.borderLeftWidth, undefined)
        assert.equal(idle.paddingLeft, 9)
        assert.equal(pressed.paddingLeft, 9)
        const idleLine = reference.children[0]({ pressed: false }).children[0] as Element
        const pressedLine = reference.children[0]({ pressed: true }).children[0] as Element
        assert.equal(idleLine.props.pointerEvents, "none")
        assert.equal(idleLine.props.style.backgroundColor, "separator")
        assert.equal(pressedLine.props.style.backgroundColor, enabled && hasHandler ? "brand" : "separator")
        for (const line of [idleLine, pressedLine]) {
          assert.equal(line.props.style.width, 2)
          assert.equal(line.props.style.position, "absolute")
          assert.equal(line.props.style.left, 0)
          assert.equal(line.props.style.top, 0)
          assert.equal(line.props.style.bottom, 0)
        }
        assert.equal(tree.props.style.backgroundColor, undefined)
      }
    }
  }
})

test("未定位时没有轮廓；系统消息只包围文字区域；重复定位更新轮廓的key而非重建气泡", () => {
  const render = bubbleRenderer()
  for (const role of ["other", "system"]) {
    const value = message(role)
    const ordinary: Element = render({ ...props, message: value })
    assert.equal(find(ordinary, "Outline"), undefined)
    const first: Element = render({ ...props, message: value, highlighted: true, highlightRequestKey: 1 })
    const repeated: Element = render({ ...props, message: value, highlighted: true, highlightRequestKey: 2 })
    assert.equal(find(first, "Outline")?.props.key, 1)
    assert.equal(find(repeated, "Outline")?.props.key, 2)
    assert.equal(first.props.style.backgroundColor, undefined)
    assert.notEqual(parentOf(first, find(first, "Outline")!), first)
  }
  assert.match(source("message-list.tsx"), /highlightRequestKey=\{focusRequestKey\}/)
})

test("轮廓采用2px主题橙色，使用原生驱动2秒线性渐隐，卸载停止动画且不拦截触摸", () => {
  for (const orange of ["#FA9D3B", "#C87D2F"]) {
    let cleanup: (() => void) | undefined
    const calls: any[] = []
    const animation = { start() { calls.push("start") }, stop() { calls.push("stop") } }
    class Value {
      value: number
      constructor(value: number) { this.value = value }
      setValue(value: number) { this.value = value }
    }
    const { MessageHighlightOutline } = load("message-highlight-outline.tsx", {
      useState: (initial: Function) => [initial()],
      useLayoutEffect: (effect: Function) => { cleanup = effect() },
      useReducedMotion: () => false,
      useXGUITheme: () => ({ colors: { orange } }),
      StyleSheet: { create: (value: unknown) => value }, Easing: { linear: "linear" },
      Animated: { Value, View: "AnimatedView", timing: (opacity: Value, options: unknown) => { calls.push({ opacity, options }); return animation } },
    })
    const tree: Element = MessageHighlightOutline({})
    const style = Object.assign({}, ...tree.props.style)
    assert.equal(style.borderWidth, 2)
    assert.equal(style.borderColor, orange)
    assert.equal(style.backgroundColor, undefined)
    assert.deepEqual([style.top, style.bottom, style.left, style.right], [-2, -2, -2, -2])
    assert.equal(tree.props.pointerEvents, "none")
    assert.equal(tree.props.accessible, false)
    assert.equal(style.opacity.value, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options)), { toValue: 0, duration: 2_000, easing: "linear", useNativeDriver: true })
    assert.equal(calls[1], "start")
    cleanup?.()
    assert.equal(calls[2], "stop")
  }
})

test("减少动态效果时只展示静态描边，不启动渐隐动画", () => {
  let animations = 0
  const { MessageHighlightOutline } = load("message-highlight-outline.tsx", {
    useState: (initial: Function) => [initial()], useLayoutEffect: (effect: Function) => effect(),
    useReducedMotion: () => true, useXGUITheme: () => ({ colors: { orange: "orange" } }),
    StyleSheet: { create: (value: unknown) => value }, Easing: {},
    Animated: { View: "AnimatedView", Value: class { setValue() {} }, timing: () => { animations++ } },
  })
  assert.equal(MessageHighlightOutline({}).type, "AnimatedView")
  assert.equal(animations, 0)
})
