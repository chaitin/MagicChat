import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const text = readFileSync(
  new URL("../src/renderer/features/chat/chat-page.tsx", import.meta.url),
  "utf8",
)
const ast = ts.createSourceFile(
  "chat-page.tsx",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const page = ast.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "ChatPage",
)!
const returned = page.body!.statements.find((node): node is ts.ReturnStatement =>
  ts.isReturnStatement(node),
)!
let root = returned.expression!
while (ts.isParenthesizedExpression(root)) root = root.expression
assert.ok(ts.isJsxElement(root))
assert.equal(root.openingElement.tagName.getText(ast), "main")

const siblingKeys = new Map<string, string>()
function collect(node: ts.Node) {
  if (ts.isJsxExpression(node)) {
    if (node.expression) collect(node.expression)
  } else if (ts.isParenthesizedExpression(node)) {
    collect(node.expression)
  } else if (ts.isConditionalExpression(node)) {
    collect(node.whenTrue)
    collect(node.whenFalse)
  } else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    collect(node.right)
  } else if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node
    const key = opening.attributes.properties.find(
      (attribute): attribute is ts.JsxAttribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "key",
    )
    if (key?.initializer && ts.isJsxExpression(key.initializer) && key.initializer.expression) {
      siblingKeys.set(opening.tagName.getText(ast), key.initializer.expression.getText(ast))
    }
  }
}
for (const child of root.children) collect(child)

function keyFor(component: string, targetId: string) {
  const expression = siblingKeys.get(component)
  assert.ok(expression, `${component} must retain its account-scoped key`)
  return runInNewContext(expression, { targetId, selectedId: "conversation" }) as string
}

test("主页面的同级组件key不能冲突，避免切页时遗留旧页面及弹窗", () => {
  const keys = [...siblingKeys.keys()].map((component) => [component, keyFor(component, "account")])
  assert.equal(new Set(keys.map(([, key]) => key)).size, keys.length, JSON.stringify(keys))
})

test("项目页面、创建弹窗和名片宿主拥有各自身份，且切换账号仍重置状态", () => {
  for (const component of ["ProjectsPage", "ProjectCreateDialog", "NamecardDialogHost"]) {
    const first = keyFor(component, "account-A")
    const second = keyFor(component, "account-B")
    assert.notEqual(first, second, component)
    assert.ok(first.includes("account-A"), component)
  }
  const keys = ["ProjectsPage", "ProjectCreateDialog", "NamecardDialogHost"].map((component) =>
    keyFor(component, "account-A"),
  )
  assert.equal(new Set(keys).size, 3)
})
