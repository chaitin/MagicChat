import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import { DISCONNECTED_REALTIME_SNAPSHOT, RealtimeContext } from "../src/realtime/realtime-context.ts"

type NativeProps = {
  children?: React.ReactNode
  accessibilityLabel?: string
  accessibilityState?: { busy?: boolean }
  disabled?: boolean
  onPress?: () => void
  style?: Record<string, unknown>
}
type Header = React.ComponentType<Record<string, unknown>>

function loadModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
  const code = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (!(name in dependencies)) throw new Error(`unexpected import ${name}`)
      return dependencies[name]
    },
  })
  return exports as T
}

function fixture() {
  const buttons: NativeProps[] = []
  const View = (props: NativeProps) => React.createElement("div", {
    "aria-label": props.accessibilityLabel,
    "data-busy": props.accessibilityState?.busy,
  }, props.children)
  const Text = (props: NativeProps) => React.createElement("span", { "data-text-style": JSON.stringify(props.style) }, props.children)
  const Button = (props: NativeProps) => {
    buttons.push(props)
    return React.createElement("button", { "aria-label": props.accessibilityLabel, disabled: props.disabled }, props.children)
  }
  const Icon = () => null
  const dependencies = {
    react: React, "react/jsx-runtime": jsxRuntime,
    "react-native": { StyleSheet: { create: (styles: unknown) => styles }, View },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24 }) },
    "lucide-react-native": { ArrowLeft: Icon, ChevronLeft: Icon, Menu: Icon },
    "@/components/mi-sans-text": { Text },
    "@/components/buttons/compact-icon-button": { CompactIconButton: Button },
    "@/components/navigation/header-button": { HeaderButton: Button },
    "@/components/icons/themed-icon": { ThemedIcon: Icon },
    "@/xgui": { XGUIButton: Button, useXGUITheme: () => ({ colors: { background0: "#fff", textPrimary: "#111" } }) },
    "@/realtime/realtime-context": { RealtimeContext },
    "@/xgui/components/xgui-loading-icon": {
      XGUILoadingIcon: ({ color, size }: { color: string; size: number }) => React.createElement("i", { "data-spinner": size, "data-color": color }),
    },
  }
  const title = loadModule<{ ConnectionTitle: Header }>("components/navigation/connection-title.tsx", dependencies)
  const shared = { ...dependencies, "@/components/navigation/connection-title": title }
  const { AppHeader } = loadModule<{ AppHeader: Header }>("components/navigation/app-header.tsx", shared)
  const { PageHeader } = loadModule<{ PageHeader: Header }>("components/navigation/page-header.tsx", shared)
  function render(HeaderComponent: Header, props: Record<string, unknown>, recovering: boolean | null = true) {
    buttons.length = 0
    const header = React.createElement(HeaderComponent, props)
    return renderToStaticMarkup(recovering === null ? header : React.createElement(RealtimeContext.Provider, {
      value: { ...DISCONNECTED_REALTIME_SNAPSHOT, isRecovering: recovering },
    }, header))
  }
  return { AppHeader, PageHeader, ConnectionTitle: title.ConnectionTitle, buttons, render }
}

test("AppHeader只替换标题，保留返回、头像和右侧操作", () => {
  const f = fixture()
  const back = () => undefined
  const action = () => undefined
  const html = f.render(f.AppHeader, {
    title: "群聊名称", onBackPress: back, backAccessory: React.createElement("b", null, "会话头像"),
    actions: [{ label: "聊天详情", icon: () => null, onPress: action }],
  })
  assert.match(html, /正在加载/)
  assert.match(html, /data-spinner="16"/)
  assert.match(html, /data-busy="true"/)
  assert.match(html, /aria-label="正在加载"/)
  assert.doesNotMatch(html, /正在连接/)
  assert.doesNotMatch(html, /群聊名称/)
  assert.match(html, /会话头像/)
  assert.equal(f.buttons.find((button) => button.accessibilityLabel === "返回")?.onPress, back)
  assert.equal(f.buttons.find((button) => button.accessibilityLabel === "聊天详情")?.onPress, action)
})

test("PageHeader保留保存按钮和禁用状态，连接时隐藏原题装饰", () => {
  const f = fixture()
  const save = () => undefined
  const html = f.render(f.PageHeader, {
    title: "编辑群名称", titleLeading: React.createElement("b", null, "原题装饰"),
    onBackPress: () => undefined, backDisabled: true,
    actionLabel: "保存", actionDisabled: true, onActionPress: save,
  })
  assert.match(html, /正在加载/)
  assert.doesNotMatch(html, /编辑群名称|原题装饰/)
  assert.equal(f.buttons.find((button) => button.accessibilityLabel === "返回")?.disabled, true)
  assert.equal(f.buttons.find((button) => button.accessibilityLabel === "保存")?.disabled, true)
  assert.equal(f.buttons.find((button) => button.accessibilityLabel === "保存")?.onPress, save)
})

test("跨页显示统一状态，恢复后使用最新动态标题而非连接前快照", () => {
  const f = fixture()
  assert.doesNotMatch(f.render(f.AppHeader, { title: "消息 (3)" }), /消息 \(3\)/)
  assert.match(f.render(f.AppHeader, { title: "设置" }), /正在加载/)
  const restored = f.render(f.AppHeader, { title: "消息 (5)" }, false)
  assert.match(restored, /消息 \(5\)/)
  assert.doesNotMatch(restored, /正在加载|data-spinner/)
  assert.match(f.render(f.PageHeader, { title: "更新后的群名称" }, false), /更新后的群名称/)
})

test("未登录或没有实时Provider时保持普通标题", () => {
  const f = fixture()
  for (const recovering of [false, null]) {
    const html = f.render(f.PageHeader, { title: "登录" }, recovering)
    assert.match(html, /登录/)
    assert.doesNotMatch(html, /正在加载|data-spinner/)
  }
})

test("加载标题沿用页面文字颜色和字号，正常时恢复原题图标", () => {
  const f = fixture()
  const html = f.render(f.PageHeader, { title: "群名称", titleColor: "#abc", titleFontSize: 16, titleFontWeight: "600" })
  assert.match(html, /data-color="#abc"/)
  assert.match(html, /fontSize&quot;:16/)
  assert.match(html, /fontWeight&quot;:&quot;600&quot;/)
  assert.match(f.render(f.PageHeader, { title: "群名称", titleLeading: React.createElement("b", null, "原题装饰") }, false), /原题装饰/)
})

test("全屏预览标题无恢复任务时不额外显示内容", () => {
  const f = fixture()
  assert.equal(f.render(f.ConnectionTitle, { color: "#fff" }, false), "")
  const html = f.render(f.ConnectionTitle, { color: "#fff" })
  assert.match(html, /正在加载/)
  assert.match(html, /data-color="#fff"/)
})

test("图片资源等待页和原生Gallery Modal都接入同一个连接标题", () => {
  const preview = readFileSync(new URL("../src/features/image-preview/image-preview-screen.tsx", import.meta.url), "utf8")
  const gallery = readFileSync(new URL("../src/xgui/components/xgui-gallery.tsx", import.meta.url), "utf8")
  assert.equal(preview.match(/<ConnectionTitle color="#fff"/g)?.length, 2)
  assert.match(preview, /header=\{<ConnectionTitle color="#fff" \/>\}/)
  assert.ok(gallery.indexOf("{header}") > gallery.indexOf("<Modal"))
  assert.match(gallery, /pointerEvents="none"[^\n]+top: Math\.max\(insets\.top, 12\)/)
})
