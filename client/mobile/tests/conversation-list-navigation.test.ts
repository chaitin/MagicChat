import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

import { buildConversationHref } from "../src/navigation/conversations.ts"

const source = ts.createSourceFile(
  "messages-screen.tsx",
  readFileSync(new URL("../src/features/messages/messages-screen.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const declarations = new Map<string, string>()
let focusCallback = ""
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    declarations.set(node.name.text, node.getText(source))
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useFocusEffect") {
    const callback = node.arguments[0]
    assert.ok(ts.isCallExpression(callback))
    assert.equal(callback.expression.getText(source), "useCallback")
    assert.equal(callback.arguments[1].getText(source), "[]")
    focusCallback = callback.arguments[0].getText(source)
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(focusCallback)
const code = ts.transpileModule(
  ["handleConversationPress", "handleConversationPressIn", "showErrorToast"].map((name) => {
    const declaration = declarations.get(name)
    assert.ok(declaration, `missing ${name}`)
    return declaration
  }).join("\n") + `\nconst onFocus = ${focusCallback};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText

type Handlers = {
  press: (id: string) => void
  pressIn: (id: string) => void
  onFocus: () => () => void
}

function harness() {
  let focused = false
  let cleanup: (() => void) | undefined
  let failNextPush = false
  const stack = ["list"]
  const prepared: string[] = []
  const recorded: string[] = []
  const errors: string[] = []
  const scope = {
    openingConversationRef: { current: true },
    pressedConversationRef: { current: null as string | null },
    navigation: { isFocused: () => focused },
    session: {},
    router: {
      push(href: { params: { conversationId: string } }) {
        if (failNextPush) {
          failNextPush = false
          throw new Error("navigation failed")
        }
        stack.push(href.params.conversationId)
      },
    },
    buildConversationHref,
    prepareConversationMessages(id: string) {
      prepared.push(id)
      return new Promise<void>(() => {})
    },
    recordConversationNavigation: (_session: unknown, id: string) => recorded.push(id),
    recordConversationPressIn: () => {},
    toast: { show: ({ message }: { message: string }) => errors.push(message) },
  }
  function render() {
    return new Function(
      ...Object.keys(scope),
      `${code}; return { press: handleConversationPress, pressIn: handleConversationPressIn, onFocus };`,
    )(...Object.values(scope)) as Handlers
  }
  let handlers = render()
  return {
    stack, prepared, recorded, errors,
    press: (id: string) => handlers.press(id),
    pressIn: (id: string) => handlers.pressIn(id),
    focus() { focused = true; cleanup = handlers.onFocus() },
    blur() { focused = false; cleanup?.(); cleanup = undefined },
    rerender() { handlers = render() },
    failNextPush() { failNextPush = true },
    loseFocusBeforeCleanup() { focused = false },
  }
}

for (const second of ["A", "B"]) {
  test(`快速点击A再点击${second}，只打开第一个对话`, () => {
    const app = harness()
    app.focus()
    app.press("A")
    app.press(second)
    assert.deepEqual(app.stack, ["list", "A"])
    assert.deepEqual(app.prepared, ["A"])
    assert.deepEqual(app.recorded, ["A"])
  })
}

test("两个对话都收到按下事件后，仍只接受第一个完成的点击", () => {
  const app = harness()
  app.focus()
  app.pressIn("A")
  app.pressIn("B")
  app.press("A")
  app.press("B")
  assert.deepEqual(app.stack, ["list", "A"])
})

test("保留按下预加载，点击不等待预加载，跳转中不再预加载其他会话", () => {
  const app = harness()
  app.focus()
  app.pressIn("A")
  app.press("A")
  app.pressIn("B")
  app.press("B")
  assert.deepEqual(app.prepared, ["A"])
  assert.deepEqual(app.stack, ["list", "A"])
})

test("跳转尚未完成时，重渲染和下一轮事件都不能解除导航锁", async () => {
  const app = harness()
  app.focus()
  app.press("A")
  app.rerender()
  await new Promise<void>((resolve) => setImmediate(resolve))
  app.press("B")
  assert.deepEqual(app.stack, ["list", "A"])
})

test("返回列表重新聚焦后可以再次打开对话，返回不会经过另一个聊天页", () => {
  const app = harness()
  app.focus()
  app.press("A")
  app.press("B")
  app.blur()
  app.stack.pop()
  assert.deepEqual(app.stack, ["list"])
  app.focus()
  app.press("B")
  assert.deepEqual(app.stack, ["list", "B"])
})

test("列表失焦且焦点清理尚未执行时，迟到的点击也不会导航或预加载", () => {
  const app = harness()
  app.focus()
  app.loseFocusBeforeCleanup()
  app.pressIn("A")
  app.press("A")
  assert.deepEqual(app.stack, ["list"])
  assert.deepEqual(app.prepared, [])
})

test("失焦清理不解锁，后台列表不会响应会话点击", () => {
  const app = harness()
  app.focus()
  app.press("A")
  app.blur()
  app.pressIn("B")
  app.press("B")
  assert.deepEqual(app.stack, ["list", "A"])
  assert.deepEqual(app.prepared, ["A"])
})

test("跳转抛错后提示失败并解除导航锁，允许立即重试", () => {
  const app = harness()
  app.focus()
  app.failNextPush()
  app.press("A")
  assert.deepEqual(app.stack, ["list"])
  assert.equal(app.errors.length, 1)
  assert.match(app.errors[0], /打开对话失败/)
  app.press("B")
  assert.deepEqual(app.stack, ["list", "B"])
})
