import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

function sourceFile(path: string) {
  const url = new URL(path, import.meta.url)
  return ts.createSourceFile(
    url.pathname,
    readFileSync(url, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
}
const source = sourceFile("../src/renderer/features/projects/task-text-context-menu.tsx")
const functions = source.statements
  .filter(ts.isFunctionDeclaration)
  .map((node) => node.getText(source))
  .join("\n")
const compiled = ts.transpileModule(functions, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
    jsxFactory: "jsx",
    jsxFragmentFactory: "Fragment",
  },
}).outputText

type Node = { type: string; props: Record<string, any> }
function jsx(type: string, props: Record<string, unknown> | null, ...children: unknown[]): Node {
  return { type, props: { ...props, children } }
}
function find(node: unknown, type: string): Node[] {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, type))
  if (!node || typeof node !== "object" || !("props" in node)) return []
  const element = node as Node
  return [...(element.type === type ? [element] : []), ...find(element.props.children, type)]
}

function harness() {
  const document = { activeElement: null as unknown }
  class Element {
    isConnected = true
    disabled = false
    contains(node: unknown) {
      return node === this
    }
    focus() {
      if (!this.disabled) document.activeElement = this
    }
  }
  class Input extends Element {
    value = "abcdef"
    selectionStart = 1
    selectionEnd = 3
    selectionDirection = "backward"
    readOnly = false
    setSelectionRange(start: number, end: number, direction: string) {
      this.selectionStart = start
      this.selectionEnd = end
      this.selectionDirection = direction
    }
  }
  class Textarea extends Input {}
  class Range {
    startContainer: Element
    endContainer: Element
    text: string
    constructor(startContainer: Element, endContainer: Element, text: string) {
      this.startContainer = startContainer
      this.endContainer = endContainer
      this.text = text
    }
    cloneRange() {
      return new Range(this.startContainer, this.endContainer, this.text)
    }
    toString() {
      return this.text
    }
  }
  let range: Range | null = null
  const selection = {
    get rangeCount() {
      return range ? 1 : 0
    },
    getRangeAt: () => range,
    removeAllRanges: () => {
      range = null
    },
    addRange: (next: Range) => {
      range = next
    },
  }
  const calls: {
    action: string
    target: unknown
    start?: number
    end?: number
    direction?: string
    text?: string
  }[] = []
  const notices: unknown[] = []
  const frames: (() => void)[] = []
  const refs: { current: unknown }[] = []
  let index = 0,
    state = false
  const bindings = {
    exports: {},
    jsx,
    Fragment: "Fragment",
    ContextMenu: "ContextMenu",
    ContextMenuTrigger: "ContextMenuTrigger",
    ContextMenuContent: "ContextMenuContent",
    ContextMenuItem: "ContextMenuItem",
    HugeiconsIcon: "HugeiconsIcon",
    Copy01Icon: "Copy01Icon",
    Scissor01Icon: "Scissor01Icon",
    ClipboardPasteIcon: "ClipboardPasteIcon",
    Delete02Icon: "Delete02Icon",
    HTMLInputElement: Input,
    HTMLTextAreaElement: Textarea,
    document,
    window: {
      getSelection: () => selection,
      taskWindow: {
        editText: async (action: string) => {
          const target = document.activeElement
          calls.push({
            action,
            target,
            ...(target instanceof Input
              ? {
                  start: target.selectionStart,
                  end: target.selectionEnd,
                  direction: target.selectionDirection,
                }
              : { text: range?.text }),
          })
          return { ok: true }
        },
      },
    },
    useRef: (initial: unknown) => refs[index++] ?? (refs[index - 1] = { current: initial }),
    useState: () => [
      state,
      (next: boolean) => {
        state = next
      },
    ],
    useAnimatedToast: () => ({ showToast: (notice: unknown) => notices.push(notice) }),
    requestAnimationFrame: (callback: () => void) => frames.push(callback),
  }
  const component = new Function(
    ...Object.keys(bindings),
    `${compiled}\nreturn TaskTextContextMenu;`,
  )(...Object.values(bindings))
  function render(element: Element, editable = false, disabled = false): Node {
    index = 0
    const tree = component({ children: jsx("field", null), editable, disabled })
    find(tree, "ContextMenuTrigger")[0].props.ref.current = element
    return tree
  }
  function open(tree: Node) {
    const trigger = find(tree, "ContextMenuTrigger")[0]
    let prevented = false
    trigger.props.onPointerDownCapture({
      button: 2,
      preventDefault: () => {
        prevented = true
      },
    })
    trigger.props.onContextMenu()
    find(tree, "ContextMenu")[0].props.onOpenChange(true)
    return prevented
  }
  async function flush() {
    while (frames.length) frames.shift()!()
    await Promise.resolve()
  }
  return {
    Input,
    Textarea,
    Element,
    Range,
    render,
    open,
    flush,
    calls,
    notices,
    setRange: (next: Range | null) => {
      range = next
    },
  }
}

const icons = ["Copy01Icon", "Scissor01Icon", "ClipboardPasteIcon", "Delete02Icon"]
test("任务与聊天输入框复用同一套菜单组件及四个图标，查看模式仅复制", () => {
  const h = harness()
  const view = h.render(new h.Element())
  assert.equal(find(view, "ContextMenu")[0].props.modal, false)
  assert.equal(find(view, "ContextMenuTrigger")[0].props.className, "select-text")
  assert.equal(find(view, "ContextMenuItem").length, 1)
  const editing = h.render(new h.Input(), true)
  assert.deepEqual(
    find(editing, "HugeiconsIcon").map((node) => node.props.icon),
    icons,
  )
  const chat = readFileSync(
    new URL("../src/renderer/features/chat/components/message-composer.tsx", import.meta.url),
    "utf8",
  )
  for (const icon of icons) assert.ok(chat.includes(`icon={${icon}}`))
  assert.equal(find(editing, "ContextMenuContent").length, 1)
  const windows = readFileSync(new URL("../src/main/task-windows.ts", import.meta.url), "utf8")
  assert.doesNotMatch(windows, /buildFromTemplate|\.on\("context-menu"/)
})

test("菜单操作前恢复标题或描述的原选区及反向选择，不受菜单聚焦影响", async () => {
  for (const Type of ["Input", "Textarea"] as const) {
    for (const action of ["copy", "cut", "paste", "delete"]) {
      const h = harness(),
        input = new h[Type]()
      const tree = h.render(input, true)
      assert.equal(h.open(tree), true)
      input.setSelectionRange(6, 6, "none")
      const updated = h.render(input, true)
      const item = find(updated, "ContextMenuItem")[
        ["copy", "cut", "paste", "delete"].indexOf(action)
      ]
      assert.equal(item.props.disabled, false)
      item.props.onSelect()
      await h.flush()
      assert.deepEqual(h.calls, [
        { action, target: input, start: 1, end: 3, direction: "backward" },
      ])
    }
  }
})

test("无选区时复制剪切删除禁用，但可在当前光标粘贴；保存中禁止修改", async () => {
  const h = harness(),
    input = new h.Input()
  input.setSelectionRange(2, 2, "none")
  h.open(h.render(input, true))
  const items = find(h.render(input, true), "ContextMenuItem")
  assert.deepEqual(
    items.map((item) => item.props.disabled),
    [true, true, false, true],
  )
  items[2].props.onSelect()
  await h.flush()
  assert.equal(h.calls[0].start, 2)
  assert.equal(h.calls[0].end, 2)
  const disabled = find(h.render(input, true, true), "ContextMenuItem")
  assert.deepEqual(
    disabled.map((item) => item.props.disabled),
    [true, true, true, true],
  )
  disabled[2].props.onSelect()
  await h.flush()
  assert.equal(h.calls.length, 1)
})

test("查看模式恢复DOM选区后复制，拒绝其他字段的选区", async () => {
  const h = harness(),
    field = new h.Element()
  h.setRange(new h.Range(field, field, "所选描述"))
  assert.equal(h.open(h.render(field)), true)
  h.setRange(null)
  const copy = find(h.render(field), "ContextMenuItem")[0]
  assert.equal(copy.props.disabled, false)
  copy.props.onSelect()
  await h.flush()
  assert.deepEqual(h.calls, [{ action: "copy", target: field, text: "所选描述" }])
  const other = new h.Element()
  h.setRange(new h.Range(other, other, "其他字段"))
  h.open(h.render(field))
  assert.equal(find(h.render(field), "ContextMenuItem")[0].props.disabled, true)
})

test("菜单打开后控件卸载或禁用时，不误操作别的输入框", async () => {
  for (const state of ["disconnected", "disabled", "readOnly"]) {
    const h = harness(),
      input = new h.Input()
    h.open(h.render(input, true))
    const item = find(h.render(input, true), "ContextMenuItem")[1]
    if (state === "disconnected") input.isConnected = false
    if (state === "disabled") input.disabled = true
    if (state === "readOnly") input.readOnly = true
    item.props.onSelect()
    await h.flush()
    assert.deepEqual(h.calls, [])
  }
})

const main = sourceFile("../src/main/index.ts")
let handler = ""
function visit(node: ts.Node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(main) === "ipcMain.handle" &&
    node.arguments[0]?.getText(main) === "TASK_WINDOW_CHANNELS.editText"
  )
    handler = node.arguments[1].getText(main)
  ts.forEachChild(node, visit)
}
visit(main)
assert.ok(handler, "必须注册任务窗口专用文本操作IPC")
const ipcCompiled = ts.transpileModule(`const handler = ${handler}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

test("文本IPC只允许任务窗口主frame，且仅对发送窗口执行四种编辑操作", async () => {
  const calls: string[] = [],
    frame = {},
    stranger = {}
  const sender = {
    mainFrame: frame,
    copy: () => calls.push("copy"),
    cut: () => calls.push("cut"),
    paste: () => calls.push("paste"),
    delete: () => calls.push("delete"),
  }
  class Failure extends Error {
    constructor(_code: string, message: string) {
      super(message)
    }
  }
  const ipc = new Function(
    "authResult",
    "AuthFailure",
    "taskWindows",
    `${ipcCompiled}\nreturn handler;`,
  )((operation: () => Promise<unknown>) => operation(), Failure, {
    getContext: (value: unknown) => {
      if (value !== sender) throw new Error("任务窗口请求来源不受信任")
    },
  })
  for (const action of ["copy", "cut", "paste", "delete"])
    await ipc({ sender, senderFrame: frame }, action)
  assert.deepEqual(calls, ["copy", "cut", "paste", "delete"])
  await assert.rejects(ipc({ sender, senderFrame: stranger }, "copy"), /不受信任/)
  await assert.rejects(
    ipc({ sender: { mainFrame: frame }, senderFrame: frame }, "copy"),
    /不受信任/,
  )
  for (const action of ["undo", "executeJavaScript", "readText", null])
    await assert.rejects(ipc({ sender, senderFrame: frame }, action), /不支持的编辑操作/)
  assert.equal(calls.length, 4)
})

test("标题、描述与预览均接入同款菜单，保持详情文字可选中和编辑器图片粘贴", () => {
  for (const [path, count] of [
    ["../src/renderer/features/projects/project-task-dialog.tsx", 1],
    ["../src/renderer/features/projects/project-task-detail-view.tsx", 2],
    ["../src/renderer/features/projects/task-description-editor.tsx", 2],
  ] as const) {
    const source = sourceFile(path)
    let menus = 0
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "TaskTextContextMenu")
        menus++
      ts.forEachChild(node, visit)
    }
    visit(source)
    assert.equal(menus, count)
  }
  const editor = readFileSync(
    new URL("../src/renderer/features/projects/task-description-editor.tsx", import.meta.url),
    "utf8",
  )
  assert.match(editor, /onPaste=\{pasteImages\}/)
  assert.match(editor, /ref=\{textarea\}/)
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8")
  assert.match(styles, /input,\s*textarea,[\s\S]*?@apply select-text;/)
})
