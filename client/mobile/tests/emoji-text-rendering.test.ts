import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import { splitEmojiText } from "../src/components/emoji-text-runs.ts"
import { parseMessageMentionTemplate } from "../src/domain/messages/message-mentions.ts"
import { linkifyMessageText } from "../src/domain/messages/message-links.ts"

const require = createRequire(import.meta.url)

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten))
  return style && typeof style === "object" ? style as Record<string, unknown> : {}
}

function NativeText({ style, children, onPress }: { style?: unknown; children?: React.ReactNode; onPress?: unknown }) {
  const font = flatten(style)
  return React.createElement("span", {
    "data-font": font.fontFamily,
    "data-weight": font.fontWeight,
    "data-clickable": typeof onPress === "function" || undefined,
    "data-decoration": font.textDecorationLine,
  }, children)
}

// Execute the production TSX with real React; only platform hosts/navigation are replaced.
function loadComponent(path: string, overrides: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText
  const module = { exports: {} as Record<string, React.ElementType> }
  const run = new vm.Script(`(function(require, exports, module) {${output}\n})`, { filename: path }).runInThisContext()
  run((name: string) => name in overrides ? overrides[name] : require(name), module.exports, module)
  return module.exports
}

const host = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children)
const native = {
  Text: NativeText,
  TextInput: NativeText,
  View: host,
  Pressable: host,
  ScrollView: host,
  Image: host,
  Linking: { openURL: () => Promise.resolve() },
  StyleSheet: { flatten, create: (value: unknown) => value, hairlineWidth: 1 },
}
const theme = { useXGUITheme: () => ({ colors: { textPrimary: "black", textSecondary: "gray", link: "blue", orange: "orange" } }) }
const textModule = loadComponent("components/mi-sans-text.tsx", {
  "react-native": native,
  "./emoji-text-runs": { splitEmojiText },
  "@/native/android-emoji-font-fallback": { getInputFontFamily: (_weight: unknown, family: string) => family },
})
const mentions = loadComponent("features/conversation/messages/message-mention-text.tsx", {
  "react-native": native,
  "@/components/mi-sans-text": textModule,
  "@/domain/messages/message-mentions": { parseMessageMentionTemplate },
  "@/domain/messages/message-links": { linkifyMessageText },
  "@/xgui": theme,
})
const markdown = loadComponent("features/conversation/messages/markdown-message.tsx", {
  "react-native": native,
  "expo-router": { useRouter: () => ({ push() {} }) },
  "@/components/mi-sans-text": textModule,
  "@/features/conversation/messages/message-mention-text": mentions,
  "@/navigation/image-preview": { buildUrlImagePreviewHref: () => "" },
  "@/xgui": theme,
})
const mentionProps = { currentUserId: "", onMentionPress() {}, resolveMentionLabel: () => "测试🙂" }

function assertEmojiFonts(html: string, values: string[]) {
  for (const value of values) assert.ok(html.includes(`data-font="JiyingEmoji" data-weight="normal">${value}</span>`), `Emoji ${value} missed its font: ${html}`)
}

test("共享输入框恢复MiSans字重并保留原生值、选区和输入回调", () => {
  const received: Record<string, unknown>[] = []
  const inputModule = loadComponent("components/mi-sans-text.tsx", {
    "react-native": {
      ...native,
      TextInput: (props: Record<string, unknown>) => {
        received.push(props)
        return React.createElement("input", { "data-font": flatten(props.style).fontFamily })
      },
    },
    "./emoji-text-runs": { splitEmojiText },
    "@/native/android-emoji-font-fallback": { getInputFontFamily: (_weight: unknown, family: string) => family },
  })
  for (const [weight, family] of [["400", "MiSans-Regular"], ["500", "MiSans-Medium"], ["600", "MiSans-Demibold"]]) {
    const onChangeText = () => {}
    const onSelectionChange = () => {}
    const selection = { start: 2, end: 4 }
    renderToStaticMarkup(React.createElement(inputModule.TextInput, {
      value: "中文 abc 123🙂",
      selection,
      onChangeText,
      onSelectionChange,
      secureTextEntry: true,
      style: [{ color: "black" }, { fontWeight: weight }],
    }))
    const props = received.at(-1)!
    assert.equal(flatten(props.style).fontFamily, family)
    assert.equal(flatten(props.style).color, "black")
    assert.equal(props.value, "中文 abc 123🙂")
    assert.equal(props.selection, selection)
    assert.equal(props.onChangeText, onChangeText)
    assert.equal(props.onSelectionChange, onSelectionChange)
    assert.equal(props.secureTextEntry, true)
    assert.equal(props.children, undefined)
  }
  renderToStaticMarkup(React.createElement(inputModule.TextInput, { style: { fontFamily: "CustomFont" } }))
  assert.equal(flatten(received.at(-1)!.style).fontFamily, "CustomFont")
})

test("普通消息的组件/Fragment纯文本路径使用同源emoji字体", () => {
  const html = renderToStaticMarkup(React.createElement(textModule.Text, null,
    React.createElement(mentions.MessageMentionText, { ...mentionProps, content: "消息😂与😵‍💫" })))
  assertEmojiFonts(html, ["😂", "😵‍💫"])
})

test("共享Text递归处理嵌套Fragment及数组而不改变文字", () => {
  const html = renderToStaticMarkup(React.createElement(textModule.Text, null,
    React.createElement(React.Fragment, null, "前", React.createElement(React.Fragment, null, ["😮‍💨", "后"]))))
  assertEmojiFonts(html, ["😮‍💨"])
  assert.equal(html.replace(/<[^>]+>/g, ""), "前😮‍💨后")
})

test("Markdown普通/加粗/斜体/代码文本全部使用同源emoji", () => {
  const html = renderToStaticMarkup(React.createElement(markdown.MarkdownMessage, {
    ...mentionProps, content: "普通🙂 **加粗😂** *斜体😮‍💨* `代码😵‍💫`", serverUrl: "",
  }))
  assertEmojiFonts(html, ["🙂", "😂", "😮‍💨", "😵‍💫"])
  assert.ok(html.includes('data-weight="600"'))
})

test("Markdown链接没有下划线，保留点击、Emoji字体与删除线", () => {
  const html = renderToStaticMarkup(React.createElement(markdown.MarkdownMessage, {
    ...mentionProps,
    content: "[说明🙂](https://example.invalid) ~~删除~~",
    serverUrl: "https://server.invalid",
  }))
  assert.ok(html.includes('data-clickable="true"'))
  assert.ok(!html.includes('data-decoration="underline"'))
  assert.ok(html.includes('data-decoration="line-through"'))
  assertEmojiFonts(html, ["🙂"])
})

test("链接与提及里的emoji字体正确且点击入口保留", () => {
  const content = "链接 https://example.invalid/🙂 提及 {(@user/12345678-1234-1234-1234-123456789abc)}"
  const html = renderToStaticMarkup(React.createElement(textModule.Text, null,
    React.createElement(mentions.MessageMentionText, { ...mentionProps, content })))
  assertEmojiFonts(html, ["🙂"])
  assert.ok(html.includes('data-clickable="true"'))
})
