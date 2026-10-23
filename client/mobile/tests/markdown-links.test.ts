import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"
import vm from "node:vm"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import { parseMessageMentionTemplate } from "../src/domain/messages/message-mentions.ts"
import { linkifyMessageText } from "../src/domain/messages/message-links.ts"

const require = createRequire(import.meta.url)
function load(path: string, overrides: Record<string, unknown>) {
  const source = readFileSync(new URL(`../src/features/conversation/messages/${path}.tsx`, import.meta.url), "utf8")
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const module = { exports: {} as Record<string, React.ElementType> }
  const run = new vm.Script(`(function(require, exports, module) {${output}\n})`).runInThisContext()
  run((name: string) => name in overrides ? overrides[name] : require(name), module.exports, module)
  return module.exports
}

function fixture() {
  const texts: { style?: { fontWeight?: string }; onPress?: () => void }[] = []
  const urls: string[] = []
  const targets: unknown[] = []
  const Text = (props: { children?: React.ReactNode; style?: { fontWeight?: string }; onPress?: () => void }) => {
    texts.push(props)
    return React.createElement("span", null, props.children)
  }
  const host = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children)
  const native = {
    Text, View: host, Pressable: host, ScrollView: host, Image: host,
    useWindowDimensions: () => ({ width: 360, scale: 3, fontScale: 0.85 }),
    StyleSheet: { create: (style: unknown) => style },
    Linking: { openURL: (url: string) => { urls.push(url); return Promise.resolve() } },
  }
  const overrides = {
    "react-native": native,
    "@/components/mi-sans-text": { Text },
    "@/domain/messages/message-mentions": { parseMessageMentionTemplate },
    "@/domain/messages/message-links": { linkifyMessageText },
    "@/xgui": { useXGUITheme: () => ({ colors: { textPrimary: "black", textSecondary: "gray", link: "blue", orange: "orange" } }) },
  }
  const mentions = load("message-mention-text", overrides)
  const markdown = load("markdown-message", {
    ...overrides,
    "lucide-react-native": { Check: host },
    "expo-router": { useRouter: () => ({ push() {} }) },
    "@/features/conversation/messages/message-mention-text": mentions,
    "@/navigation/image-preview": { buildUrlImagePreviewHref: () => "" },
  })
  const props = { currentUserId: "me", onMentionPress: (target: unknown) => targets.push(target), resolveMentionLabel: () => "Alice" }
  return {
    texts, urls, targets,
    render: (content: string, plain = false) => renderToStaticMarkup(React.createElement(plain ? mentions.MessageMentionText : markdown.MarkdownMessage, { ...props, content, serverUrl: "https://server.invalid" })),
    clickable: () => texts.filter((text) => typeof text.onPress === "function"),
  }
}

test("Markdown链接地址型标签不再产生内层链接，点击始终使用显式href且不额外加粗", () => {
  const f = fixture()
  f.render("[https://label.invalid/path](https://target.invalid/destination)")
  const links = f.clickable()
  assert.equal(links.length, 1)
  assert.equal(links[0].style?.fontWeight, undefined)
  links[0].onPress!()
  assert.deepEqual(f.urls, ["https://target.invalid/destination"])
})

test("Markdown裸URL由Markdown解析器处理一次，普通消息仍保留自动链接", () => {
  for (const plain of [false, true]) {
    const f = fixture()
    f.render("地址 https://example.invalid/path", plain)
    const links = f.clickable()
    assert.equal(links.length, 1)
    assert.equal(links[0].style?.fontWeight, plain ? "600" : undefined)
    links[0].onPress!()
    assert.deepEqual(f.urls, ["https://example.invalid/path"])
  }
})

test("Markdown文本仍解析提及并保留点击目标，代码里的URL不变为链接", () => {
  const f = fixture()
  f.render("{(@user/12345678-1234-1234-1234-123456789abc)} `https://code.invalid`")
  assert.equal(f.clickable().length, 1)
  f.clickable()[0].onPress!()
  assert.deepEqual(f.targets, [{ id: "12345678-1234-1234-1234-123456789abc", type: "user" }])
  assert.deepEqual(f.urls, [])
})

test("关闭重复链接解析后，危险协议仍不可点击，合法相对地址仍按服务器解析", () => {
  const f = fixture()
  f.render("[bad](javascript:alert%281%29) [relative](/path)")
  assert.equal(f.clickable().length, 1)
  f.clickable()[0].onPress!()
  assert.deepEqual(f.urls, ["https://server.invalid/path"])
})
