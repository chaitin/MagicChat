import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { cardSummary } from "../../shared/card-summary.ts"
import { parseTaskLink } from "../../shared/task-links.ts"
import { parseContactLink } from "../../shared/contact-links.ts"

const source = readFileSync(
  new URL("../src/features/conversation/messages/message-body.tsx", import.meta.url),
  "utf8",
)
const ast = ts.createSourceFile("body.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const fn = ast.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "MessageLinkCard",
)!
const js = ts.transpileModule("export " + fn.getText(ast), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
  },
}).outputText
const exports = {} as any
runInNewContext(js, {
  exports,
  cardSummary,
  parseTaskLink,
  parseContactLink,
  useXGUITheme: () => ({
    colors: { textPrimary: "#111", textSecondary: "#888" },
  }),
  useRef: (current: any) => ({ current }),
  Pressable: "Pressable",
  View: "View",
  Text: "Text",
  MessageContentIcon: "Icon",
  React: {
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props: { ...props, children },
    }),
  },
})
function nodes(n: any): any[] {
  if (Array.isArray(n)) return n.flatMap(nodes)
  return n && typeof n === "object" ? [n, ...nodes(n.props?.children)] : []
}
const id = "550e8400-e29b-41d4-a716-446655440000"
function render(url: string, description: string, onPress = () => {}, onLongPress = () => {}) {
  return exports.MessageLinkCard({
    url,
    description,
    title: "标题",
    onPress,
    onLongPress,
  })
}
test("任务新旧协议使用任务图标及状态、DotIcon和优先级", () => {
  for (const url of ["jiying://task/" + id + "/" + id, "/projects/" + id + "?taskId=" + id]) {
    const root = render(url, "状态: 进行中\n优先级: 高优先级\n负责人: 张三")
    const all = nodes(root)
    assert.equal(root.props.style.flexDirection, "row")
    assert.ok(all.some((n) => n.props?.kind === "task"))
    assert.ok(all.some((n) => n.props?.kind === "dot"))
    for (const text of ["进行中", "高优先级"])
      assert.ok(
        all.some(
          (n) => n.type === "Text" && n.props.children[0] === text && n.props.numberOfLines === 1,
        ),
      )
    assert.ok(!all.some((n) => n.props?.children?.includes("张三")))
  }
  const old = nodes(render("jiying://task/" + id + "/" + id, "状态: 待办"))
  assert.ok(!old.some((n) => n.props?.kind === "dot"))
})
test("联系人摘要优先级和应用空说明均为单行", () => {
  for (const [description, expected] of [
    ["邮箱: a@test.com\n手机号: 123\n昵称: 小王\n姓名: 王明", "a@test.com"],
    ["手机号: 123\n昵称: 小王\n姓名: 王明", "123"],
    ["昵称: 小王\n姓名: 王明", "小王"],
    ["姓名: 王明", "王明"],
  ]) {
    const all = nodes(render("jiying://contact/" + id, description))
    assert.ok(all.some((n) => n.props?.kind === "contact"))
    assert.ok(
      all.some(
        (n) => n.type === "Text" && n.props.children[0] === expected && n.props.numberOfLines === 1,
      ),
    )
  }
  assert.ok(
    nodes(render("jiying://app/" + id, " ")).some((n) => n.props?.children?.[0] === "暂无说明"),
  )
  assert.ok(
    nodes(render("jiying://group/" + id, "2 位成员")).some(
      (n) => n.props?.children?.[0] === "2 位成员",
    ),
  )
})
test("长按菜单不误触导航，普通卡片仍显示三行", () => {
  let presses = 0,
    longs = 0
  const root = render(
    "jiying://contact/" + id,
    "说明",
    () => presses++,
    () => longs++,
  )
  root.props.onPressIn()
  root.props.onLongPress()
  root.props.onPress()
  assert.equal(longs, 1)
  assert.equal(presses, 0)
  root.props.onPressIn()
  root.props.onPress()
  assert.equal(presses, 1)
  const generic = render("https://example.test", "普通说明")
  assert.ok(nodes(generic).some((n) => n.type === "Text" && n.props.numberOfLines === 3))
})
