import { cardDisplayTitle } from "../../shared/card-title.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseContactLink } from "../../shared/contact-links.ts"
import { parseTaskLink } from "../../shared/task-links.ts"

test("移动端新旧任务卡片仅提示暂不支持，名片导航保持不变", () => {
  const text = readFileSync(new URL("../src/features/conversation/messages/message-body.tsx", import.meta.url), "utf8")
  const ast = ts.createSourceFile("body.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let component: ts.FunctionExpression | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionExpression(node) && node.name?.text === "MessageBody") component = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(component)
  const code = ts.transpileModule("exports.MessageBody = " + component.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const messages: any[] = [], targets: any[] = [], alerts: any[] = [], external: string[] = []
  const exports = {} as any
  runInNewContext(code, {
    exports, cardDisplayTitle, parseTaskLink, parseContactLink, MessageLinkCard: "MessageLinkCard",
    useXGUITheme: () => ({ colors: {} }),
    useXGUIToast: () => ({ show: (value: any) => messages.push(value) }),
    useRef: (current: any) => ({ current }),
    React: { createElement: (type: any, props: any) => ({ type, props }) },
    Alert: { alert: (...args: any[]) => alerts.push(args) },
    openExternalUrl: (url: string) => external.push(url),
  })
  const id = "550e8400-e29b-41d4-a716-446655440000"
  function click(url: string) {
    exports.MessageBody({ body: { type: "card", title: "卡片", description: "", url }, onMentionPress: (value: any) => targets.push(value) }).props.onPress()
  }
  for (const url of ["jiying://task/" + id + "/" + id, "/projects/" + id + "?taskId=" + id]) click(url)
  assert.equal(messages.length, 2)
  for (const message of messages) {
    assert.equal(message.message, "暂不支持查看任务")
    assert.equal(message.modal, false)
    assert.equal(message.type, "text")
  }
  assert.equal(external.length, 0)
  assert.equal(alerts.length, 0)
  for (const kind of ["contact", "app", "group"]) click("jiying://" + kind + "/" + id)
  assert.equal(targets.length, 3)
  click("jiying://task/invalid")
  assert.equal(alerts.length, 1)
  assert.equal(messages.length, 2)
  assert.equal(external.length, 0)
  click("https://example.test")
  assert.deepEqual(external, ["https://example.test"])
})
