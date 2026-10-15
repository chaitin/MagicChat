import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../src/", import.meta.url))
const resizedFiles = [
  "app/(app)/(drawer)/(tabs)/_layout.tsx",
  "components/lists/list-item-content.tsx",
  "components/navigation/app-header.tsx",
  "features/conversation/voice/message-voice-gesture-overlay.tsx",
  "features/entity-details/entity-detail-action.tsx",
  "features/entity-details/entity-detail-fields.tsx",
  "features/me/me-screen.tsx",
  "features/projects/office-screen.tsx",
  "features/storage/storage-management-screen.tsx",
  "xgui/components/xgui-list.tsx",
  "xgui/components/xgui-popover-menu.tsx",
]

function fontSizes(path: string) {
  const file = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true)
  const sizes: { value: number; line: number }[] = []
  function collect(node: ts.Node) {
    if (ts.isNumericLiteral(node) || (ts.isStringLiteral(node) && /^\d+(?:px|pt|sp|dp)?$/.test(node.text))) {
      sizes.push({ value: Number.parseFloat(node.text), line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 })
    }
    ts.forEachChild(node, collect)
  }
  function visit(node: ts.Node) {
    if ((ts.isPropertyAssignment(node) || ts.isJsxAttribute(node) || ts.isParameter(node) || ts.isBindingElement(node) || ts.isVariableDeclaration(node)) && node.initializer) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : node.name.getText(file)
      if (/font[-_]?size$/i.test(name)) collect(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return sizes
}

test("普通字号不再使用17或22，仅指定大标题保留18或20，表情保持28", () => {
  const larger: Record<string, number[]> = {}
  for (const path of readdirSync(root, { recursive: true })) {
    if (!/\.(?:ts|tsx)$/.test(path)) continue
    const sizes = fontSizes(path).map(size => size.value).filter(size => size > 16)
    if (sizes.length) larger[path.replaceAll("\\", "/")] = sizes
  }
  assert.deepEqual(larger, {
    "components/navigation/page-header.tsx": [18],
    "features/entity-details/entity-detail-screen.tsx": [18],
    "features/qr-scanner/qr-scanner-screen.tsx": [18],
    "features/qr-scanner/qr-webview-screen.tsx": [18],
    "features/servers/server-management-screen.tsx": [20],
    "features/conversation/composer/composer-accessory-panel.tsx": [28],
  })
})

test("原18号文字改16，列表副标题为12，聊天正文保持15", () => {
  for (const path of resizedFiles) {
    assert.ok(fontSizes(path).some(size => size.value === 16), `${path} 未设置16号字`)
  }
  assert.deepEqual(fontSizes("components/lists/list-item-content.tsx").map(size => size.value), [12, 16, 12, 12])
  assert.ok(fontSizes("features/conversation/messages/message-body.tsx").some(size => size.value === 15))
})

test("添加账号、添加服务器及其他默认按钮统一使用16号字", () => {
  for (const [path, label] of [
    ["features/accounts/account-management-screen.tsx", "添加账号"],
    ["features/servers/server-management-screen.tsx", "添加服务器"],
  ]) {
    const file = ts.createSourceFile(path, readFileSync(join(root, path), "utf8"), ts.ScriptTarget.Latest, true)
    let matches = 0
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(file) === "XGUIButton") {
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
        const name = attributes.find(attr => attr.name.getText(file) === "accessibilityLabel")?.initializer
        if (name && ts.isStringLiteral(name) && name.text === label) {
          const style = attributes.find(attr => attr.name.getText(file) === "textStyle")?.initializer
          assert.ok(style && ts.isJsxExpression(style) && style.expression && ts.isObjectLiteralExpression(style.expression))
          const size = style.expression.properties.find(prop => ts.isPropertyAssignment(prop) && prop.name.getText(file) === "fontSize")
          assert.ok(size && ts.isPropertyAssignment(size) && ts.isNumericLiteral(size.initializer))
          assert.equal(Number(size.initializer.text), 16)
          matches++
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    assert.equal(matches, 1, label)
  }
  assert.ok(fontSizes("xgui/components/xgui-button.tsx").some(size => size.value === 16))
})
