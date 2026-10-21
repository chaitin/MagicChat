import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

type Frame = { x: number; y: number; width: number; height: number }
type Element = { type: string; props: Record<string, unknown> }
type Toast = { modal: boolean; type: "loading" | "success" | "error" | "text"; message: string }
type OverlayStyle = { top: number; left: number; width: number; height: number; transform: { translateY: number }[] }

function harness(initialFrame: Frame) {
  let frame = initialFrame
  let dismissed = 0
  const source = readFileSync(new URL("../src/xgui/components/xgui-toast.tsx", import.meta.url), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {} as {
    renderToast: (props: { onDismiss: () => void; toast: Toast | null }) => Element | null
  }
  runInNewContext(code + "\nexports.renderToast = XGUIToastView;", {
    exports,
    require(name: string) {
      if (name === "react") return { createContext: () => ({}) }
      if (name === "react/jsx-runtime") return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) }
      if (name === "react-native") return { Modal: "Modal", View: "View", StyleSheet: { create: (style: unknown) => style } }
      if (name === "react-native-safe-area-context") return { useSafeAreaFrame: () => frame }
      if (name === "@/components/mi-sans-text") return { Text: "Text" }
      if (name === "react-native-svg") return { default: "Svg", Path: "Path" }
      if (name === "@/xgui/components/xgui-loading-icon") return { XGUILoadingIcon: "LoadingIcon" }
      if (name === "@/xgui/theme/use-xgui-theme") return { useXGUITheme: () => ({ colors: { background4: "black", toastForeground: "white" } }) }
      throw new Error(`unexpected import ${name}`)
    },
  })
  return {
    render(toast: Toast | null) {
      return exports.renderToast({ onDismiss: () => { dismissed++ }, toast })
    },
    setFrame(next: Frame) { frame = next },
    dismissed: () => dismissed,
  }
}

const loading: Toast = { modal: true, type: "loading", message: "正在检查更新" }
const success: Toast = { modal: false, type: "success", message: "已经是最新版本" }

function overlay(element: Element) {
  return element.type === "Modal" ? element.props.children as Element : element
}

function center(element: Element, frame: Frame) {
  const content = overlay(element)
  const style = Object.assign({}, ...(content.props.style as unknown[]).filter(Boolean)) as OverlayStyle
  const origin = element.type === "Modal" ? { x: 0, y: 0 } : frame
  return {
    x: origin.x + style.left + style.width / 2,
    y: origin.y + style.top + style.height / 2 + style.transform[0].translateY,
  }
}

for (const [name, frame] of [
  ["状态栏和底部导航栏占空间", { x: 0, y: 24, width: 393, height: 740 }],
  ["边到边全屏", { x: 0, y: 0, width: 393, height: 852 }],
  ["横屏侧边存在偏移", { x: 32, y: 0, width: 780, height: 393 }],
] as const) {
  test(`${name}时，loading和最新版提示的屏幕中心点一致`, () => {
    const app = harness(frame)
    const pending = app.render(loading)!
    const result = app.render(success)!
    assert.deepEqual(center(pending, frame), center(result, frame))
    assert.deepEqual(center(result, frame), { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 - 40 })
  })
}

test("loading仍用原生Modal阻挡点击，结果提示仍为可穿透覆盖层", () => {
  const app = harness({ x: 0, y: 24, width: 393, height: 740 })
  const pending = app.render(loading)!
  const result = app.render(success)!
  assert.equal(pending.type, "Modal")
  assert.equal(pending.props.statusBarTranslucent, true)
  assert.equal(pending.props.navigationBarTranslucent, true)
  assert.equal(overlay(pending).props.pointerEvents, "auto")
  assert.equal(result.type, "View")
  assert.equal(result.props.pointerEvents, "none")
})

test("Android返回不关闭loading，但可关闭其他模态提示", () => {
  const app = harness({ x: 0, y: 0, width: 393, height: 852 })
  const pending = app.render(loading)!
  ;(pending.props.onRequestClose as () => void)()
  assert.equal(app.dismissed(), 0)
  const result = app.render({ ...success, modal: true })!
  ;(result.props.onRequestClose as () => void)()
  assert.equal(app.dismissed(), 1)
})

test("窗口变化后重新计算定位，不缓存旧方向的尺寸与偏移", () => {
  const app = harness({ x: 0, y: 24, width: 393, height: 740 })
  app.render(loading)
  const landscape = { x: 32, y: 0, width: 780, height: 393 }
  app.setFrame(landscape)
  assert.deepEqual(center(app.render(loading)!, landscape), center(app.render(success)!, landscape))
  assert.deepEqual(center(app.render(success)!, landscape), { x: 422, y: 156.5 })
})

test("隐藏Toast时不创建覆盖层或原生窗口", () => {
  assert.equal(harness({ x: 0, y: 0, width: 393, height: 852 }).render(null), null)
})
