import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

type Element = { type: string; props: Record<string, any>; children: any[] }
const code = readFileSync(new URL("../src/features/conversation/messages/markdown-message.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("markdown-message.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = ast.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name?.text === "MarkdownCodeBlock") ||
  (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ["styles", "horizontalScrollStyle"].includes(item.name.getText(ast))))
).map((node) => node.getText(ast)).join("\n")
const exports: any = {}
runInNewContext(ts.transpileModule(`${declarations}\nexport { MarkdownCodeBlock }`, {
  fileName: "markdown-message.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText, {
  exports, View: "View", ScrollView: "Scroll", Text: "Text",
  StyleSheet: { create: (style: unknown) => style },
  React: { createElement: (type: string, props: unknown, ...children: unknown[]) => ({ type, props, children }) },
})

test("代码块与desktop一致使用foreground/8背景，无边框，深浅色模式均随主题变化", () => {
  for (const textColor of ["rgba(0,0,0,0.9)", "rgba(255,255,255,0.8)"]) {
    const codeBackground = textColor.startsWith("rgba(0,") ? "rgba(0,0,0,0.072)" : "rgba(255,255,255,0.064)"
    const tree: Element = exports.MarkdownCodeBlock({ context: { textColor, codeBackground, selectable: true }, token: { info: "ts", content: "const x = 1\n" } })
    assert.equal(tree.props.style.borderWidth, undefined)
    assert.equal(tree.props.style.borderColor, undefined)
    assert.equal(tree.props.style.backgroundColor, codeBackground)
    assert.equal(tree.props.style.borderRadius, 4)
    assert.equal(tree.props.style.overflow, "hidden")
  }
})

test("与desktop一致隐藏语言标题、缩小到14号等宽字，保留横向滚动和文本选择",  () => {
  for (const selectable of [false, true]) {
    for (const info of ["", "python extra-info"]) {
      const tree: Element = exports.MarkdownCodeBlock({ context: { textColor: "text", codeBackground: "code-bg", selectable }, token: { info, content: "  print(1)\n\n" } })
      assert.equal(tree.children.length, 1)
      const scroll = tree.children.find((child) => child?.type === "Scroll")!
      assert.equal(scroll.props.horizontal, true)
      assert.equal(scroll.props.nestedScrollEnabled, true)
      const body = scroll.children[0]
      const style = Object.assign({}, ...body.props.style)
      assert.equal(style.fontFamily, "JetBrainsMono")
      assert.equal(style.fontSize, 14)
      assert.equal(style.lineHeight, 23)
      assert.equal(style.color, "text")
      assert.equal(style.padding, 12)
      assert.equal(style.paddingBottom, 16)
      assert.equal(body.props.selectable, selectable)
      assert.equal(body.children[0], "  print(1)\n")
    }
  }
})
