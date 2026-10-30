import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as jsxRuntime from "react/jsx-runtime"
import ts from "typescript"
import type { XGUIBadgeProps } from "../src/xgui/components/xgui-badge"

type Element = { props: { style: unknown; children: Element | number | string | null; [key: string]: unknown } }

const exports = {} as { XGUIBadge: (props: XGUIBadgeProps) => Element | null }
const dependencies: Record<string, unknown> = {
  "react/jsx-runtime": jsxRuntime,
  "react-native": { View: "View", StyleSheet: { create: (styles: unknown) => styles } },
  "@/components/mi-sans-text": { Text: "Text" },
  "@/xgui/theme/use-xgui-theme": { useXGUITheme: () => ({ colors: { destructive: "#ff0000" } }) },
}
const source = readFileSync(new URL("../src/xgui/components/xgui-badge.tsx", import.meta.url), "utf8")
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
runInNewContext(code, { exports, require: (name: string) => {
  assert.ok(name in dependencies, name)
  return dependencies[name]
} })
function style(element: Element) {
  return Object.assign({}, ...[element.props.style].flat(Infinity).filter(Boolean))
}
function text(element: Element) {
  return element.props.children as Element
}

test("99+保持单行，默认与大号徽标均能超出窄图标容器容纳完整文本", () => {
  for (const [size, minWidth, minHeight, fontSize] of [
    ["default", 34, 18, 12], ["large", 40, 22, 14],
  ] as const) {
    for (const count of [100, 999, 10_000]) {
      const badge = exports.XGUIBadge({ count, size })!
      assert.equal(text(badge).props.children, "99+")
      assert.equal(text(badge).props.numberOfLines, 1)
      assert.equal(style(badge).minWidth, minWidth)
      assert.ok(style(badge).minWidth > 30)
      assert.equal(style(badge).minHeight, minHeight)
      assert.equal(style(text(badge)).fontSize, fontSize)
    }
  }
})

test("个位与两位数保留原有徽标尺寸、字号和数值", () => {
  for (const [size, minWidth, minHeight] of [["default", 18, 18], ["large", 22, 22]] as const) {
    for (const count of [1, 9, 10, 99]) {
      const badge = exports.XGUIBadge({ count, size })!
      assert.equal(text(badge).props.children, count)
      assert.equal(style(badge).minWidth, minWidth)
      assert.equal(style(badge).minHeight, minHeight)
    }
  }
})

test("纯红点不渲染数字，不应用99+的宽度，空计数不显示徽标", () => {
  for (const size of ["default", "large"] as const) {
    const dot = exports.XGUIBadge({ count: 100, dot: true, size })!
    assert.equal(dot.props.children, null)
    assert.equal(style(dot).minWidth, 10)
    assert.equal(style(dot).minHeight, 10)
    assert.equal(style(dot).paddingHorizontal, 0)
  }
  assert.equal(exports.XGUIBadge({ count: 0 }), null)
  assert.equal(exports.XGUIBadge({ count: -1 }), null)
})

test("保留定位、自定义颜色和无障碍标签", () => {
  const badge = exports.XGUIBadge({
    count: 100, accessibilityLabel: "100 条未读消息",
    backgroundColor: "#123456", textColor: "#abcdef",
    style: { position: "absolute", right: -8, top: -1 },
  })!
  assert.equal(style(badge).right, -8)
  assert.equal(style(badge).top, -1)
  assert.equal(style(badge).backgroundColor, "#123456")
  assert.equal(style(text(badge)).color, "#abcdef")
  assert.equal(badge.props.accessibilityLabel, "100 条未读消息")
  assert.equal(badge.props.accessible, true)
})
