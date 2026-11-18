import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

type Props = { children?: React.ReactNode; accessibilityLabel?: string }
type MemberState = {
  members: { id: string; name: string; nickname: string; avatar: string }[]
  page: number; total: number; loading: boolean; error: string
}

function fixture(state: MemberState) {
  const View = ({ children }: Props) => {
    React.Children.forEach(children, (child) => {
      assert.ok(typeof child !== "string" && typeof child !== "number",
        "View 不能直接包含文本，包括空字符串")
    })
    return React.createElement("div", null, children)
  }
  const Text = ({ children }: Props) => React.createElement("span", null, children)
  const Icon = () => null
  const dependencies: Record<string, unknown> = {
    react: { ...React, useEffect: () => undefined, useSyncExternalStore: () => state },
    "react/jsx-runtime": jsxRuntime,
    "react-native": {
      View, Text, TextInput: Icon, ActivityIndicator: Icon,
      Pressable: ({ children, accessibilityLabel }: Props) =>
        React.createElement("button", { "aria-label": accessibilityLabel }, children),
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "lucide-react-native": { Building2: Icon, ChevronRight: Icon, Folder: Icon },
    "@tanstack/react-query": {},
    "expo-router": {},
    "@/components/layout/keyboard-aware-screen": { KeyboardAwareScreen: View },
    "@/components/navigation/app-header": {},
    "./organization-directory-breadcrumbs": {},
    "./organization-directory-navigation": {},
    "@/components/lists/list-item-content": {},
    "@/data/contacts/organization-api": {},
    "@/domain/contacts/contact-display": {},
    "@/features/contacts/contact-directory-avatar": {},
    "@/navigation/entity-details": {},
    "@/providers/auth-provider": {},
    "@/providers/client-data-provider": {},
    "@/xgui": { useXGUITheme: () => ({ colors: {} }) },
    "../../../../shared/organization-directory": {
      OrganizationMemberPager: class {
        subscribe = () => () => undefined
        getSnapshot = () => state
      },
    },
  }
  const source = readFileSync(new URL("../src/features/contacts/organization-directory-screen.tsx", import.meta.url), "utf8")
  const code = ts.transpileModule(source + "\nexport { NodeMembers, OrganizationLevelContent };", {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, React.ComponentType<Record<string, unknown>>> = {}
  runInNewContext(code, {
    exports,
    require(name: string) {
      assert.ok(name in dependencies, `未模拟的依赖 ${name}`)
      return dependencies[name]
    },
  })
  return { exports, Text }
}

const empty: MemberState = { members: [], page: 0, total: 0, loading: false, error: "" }

test("组织成员在初始、加载、空列表及有成员时不向 View 输出空文本", () => {
  for (const state of [
    empty, { ...empty, loading: true }, { ...empty, page: 1 },
    { ...empty, page: 1, total: 1, members: [{ id: "u1", name: "成员一", nickname: "", avatar: "" }] },
  ]) {
    const { exports, Text } = fixture(state)
    const html = renderToStaticMarkup(React.createElement(exports.NodeMembers, {
      departmentId: "department", session: {}, contacts: [],
      renderMember: (user: { id: string; name: string }) => React.createElement(Text, { key: user.id }, user.name),
    }))
    if (state.page && !state.members.length) assert.match(html, /当前层级暂无内容/)
    if (state.members.length) assert.match(html, /成员一/)
  }
})

test("有直属下级时隐藏成员空态，整层为空才显示空态", () => {
  for (const hasChildNodes of [true, false]) {
    for (const state of [empty, { ...empty, loading: true }, { ...empty, page: 1 }, { ...empty, page: 1, error: "加载失败" }]) {
      const { exports } = fixture(state)
      const html = renderToStaticMarkup(React.createElement(exports.NodeMembers, {
        departmentId: "department", hasChildNodes, session: {}, contacts: [], renderMember: () => null,
      }))
      if (!hasChildNodes && state.page > 0 && !state.loading && !state.error) {
        assert.match(html, /当前层级暂无内容/)
      } else {
        assert.doesNotMatch(html, /当前层级暂无内容|暂无成员/)
      }
      if (state.error) {
        assert.match(html, /加载失败/)
        assert.match(html, /重试/)
      }
    }
  }
})

test("搜索时只显示匹配人员或人员空态，不显示组织节点和部门成员", () => {
  for (const matches of [[], [{ id: "member", name: "张三" }]]) {
    const { exports, Text } = fixture(empty)
    const html = renderToStaticMarkup(React.createElement(exports.OrganizationLevelContent, {
      loading: false, searching: true, matches,
      nodes: [{ key: "department", name: "研发部" }],
      renderNode: () => React.createElement(Text, null, "组织节点"),
      members: React.createElement(Text, null, "原部门成员"),
      renderMember: (user: { id: string; name: string }) => React.createElement(Text, { key: user.id }, user.name),
      onRetry: () => undefined,
    }))
    assert.doesNotMatch(html, /组织节点|原部门成员|当前层级暂无内容/)
    if (matches.length) {
      assert.match(html, /张三/)
      assert.doesNotMatch(html, /没有匹配的成员/)
    } else {
      assert.match(html, /没有匹配的成员/)
    }
  }
})

test("组织成员错误仍显示重试，组织快照空错误消息不渲染裸文本", () => {
  const { exports } = fixture({ ...empty, error: "加载失败" })
  const html = renderToStaticMarkup(React.createElement(exports.NodeMembers, {
    departmentId: "department", session: {}, contacts: [], renderMember: () => null,
  }))
  assert.match(html, /加载失败/)
  assert.match(html, /重试/)
  assert.doesNotThrow(() => renderToStaticMarkup(React.createElement(exports.OrganizationLevelContent, {
    loading: false, error: "", matches: [], searching: false,
    nodes: [], renderNode: () => null, renderMember: () => null, onRetry: () => undefined,
  })))
})
