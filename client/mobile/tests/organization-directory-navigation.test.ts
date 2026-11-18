import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import * as React from "react"
import * as jsxRuntime from "react/jsx-runtime"
import { renderToStaticMarkup } from "react-dom/server"
import ts from "typescript"

import * as directory from "../../shared/organization-directory.ts"
import * as navigation from "../src/features/contacts/organization-directory-navigation.ts"

const snapshot = {
  units: [{ id: "company", parent_id: null, name: "单位", kind: "group" }],
  departments: [
    { id: "root", unit_id: "company", parent_id: null, name: "单位", is_root: true },
    { id: "product", unit_id: "company", parent_id: "root", name: "产品部", is_root: false },
    { id: "design", unit_id: "company", parent_id: "product", name: "设计组", is_root: false },
    { id: "engineering", unit_id: "company", parent_id: "root", name: "研发部", is_root: false },
  ],
}
const tree = directory.buildOrganizationDirectoryTree(snapshot)

test("路径只包含当前节点的祖先，返回祖先后仅列直属下级", () => {
  const path = navigation.findOrganizationPath(tree, "department:design")
  assert.deepEqual(path.map((node) => node.name), ["单位", "产品部", "设计组"])
  assert.deepEqual(path.at(-2)?.children.map((node) => node.name), ["设计组"])
  assert.deepEqual(navigation.findOrganizationPath(tree, "unit:company").at(-1)?.children.map((node) => node.name), ["产品部", "研发部"])
  assert.deepEqual(navigation.findOrganizationPath(tree, null), [])
  assert.deepEqual(navigation.findOrganizationPath(tree, "deleted"), [])
})

test("跨层级搜索返回平铺结果及完整路径，不把匹配节点的子树展开", () => {
  const matches = navigation.searchOrganizationNodes(tree, "设计")
  assert.equal(matches.length, 1)
  assert.equal(matches[0].node.key, "department:design")
  assert.deepEqual(matches[0].path.map((node) => node.name), ["单位", "产品部", "设计组"])
  assert.deepEqual(navigation.searchOrganizationNodes(tree, " "), [])
})

type Props = {
  children?: React.ReactNode
  accessibilityLabel?: string
  onPress?: () => void
}

function fixture() {
  const state: unknown[] = ["", null]
  let cursor = 0
  let backCount = 0
  const buttons = new Map<string, () => void>()
  let breadcrumbPath: directory.OrganizationDirectoryNode[] = []
  let navigateBreadcrumb: (key: string | null) => void = () => undefined
  const View = ({ children }: Props) => React.createElement("div", null, children)
  const Text = ({ children }: Props) => React.createElement("span", null, children)
  const Icon = () => null
  const source = readFileSync(new URL("../src/features/contacts/organization-directory-screen.tsx", import.meta.url), "utf8")
  const code = ts.transpileModule(source + "\nexport { OrganizationDirectoryContent };", {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const dependencies: Record<string, unknown> = {
    react: {
      ...React, useEffect: () => undefined,
      useState: (initial: unknown) => {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        return [state[index], (value: unknown) => { state[index] = value }]
      },
      useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
    },
    "react/jsx-runtime": jsxRuntime,
    "react-native": {
      View, Text, ActivityIndicator: Icon,
      Pressable: ({ children, accessibilityLabel, onPress }: Props) => {
        if (accessibilityLabel && onPress) buttons.set(accessibilityLabel, onPress)
        return React.createElement("button", null, children)
      },
      StyleSheet: { create: (styles: unknown) => styles },
    },
    "lucide-react-native": { Building2: Icon, ChevronRight: Icon, Folder: Icon },
    "@tanstack/react-query": { useQuery: () => ({ data: snapshot, dataUpdatedAt: 1, refetch: () => undefined }) },
    "expo-router": { useRouter: () => ({ back() { backCount++ }, push() {} }), useFocusEffect: () => undefined },
    "@/components/layout/keyboard-aware-screen": { KeyboardAwareScreen: View },
    "@/components/navigation/app-header": { AppHeader: ({ onBackPress }: { onBackPress: () => void }) => { buttons.set("返回", onBackPress); return null } },
    "@/components/lists/list-item-content": { ListItemContent: ({ title }: { title: string }) => React.createElement(Text, null, title) },
    "./organization-directory-breadcrumbs": {
      OrganizationDirectoryBreadcrumbs: ({ path, onNavigate }: { path: directory.OrganizationDirectoryNode[]; onNavigate: typeof navigateBreadcrumb }) => {
        breadcrumbPath = path
        navigateBreadcrumb = onNavigate
        return null
      },
    },
    "./organization-directory-navigation": navigation,
    "@/data/contacts/organization-api": {},
    "@/domain/contacts/contact-display": {},
    "@/features/contacts/contact-directory-avatar": {},
    "@/navigation/entity-details": {},
    "@/providers/auth-provider": {},
    "@/providers/client-data-provider": { useClientContacts: () => ({ contacts: { users: [] } }) },
    "@/xgui": { useXGUITheme: () => ({ colors: {} }), XGUIFilledSearchBar: Icon },
    "../../../../shared/organization-directory": directory,
  }
  const exports = {} as { OrganizationDirectoryContent: React.ComponentType<{ session: object }> }
  runInNewContext(code, {
    exports,
    require(name: string) {
      assert.ok(name in dependencies, `未模拟的依赖 ${name}`)
      return dependencies[name]
    },
  })
  return {
    render() {
      cursor = 0
      buttons.clear()
      return renderToStaticMarkup(React.createElement(exports.OrganizationDirectoryContent, { session: {} }))
    },
    click(name: string) { assert.ok(buttons.has(name)); buttons.get(name)!() },
    path: () => breadcrumbPath.map((node) => node.name),
    breadcrumb(key: string | null) { navigateBreadcrumb(key) },
    backCount: () => backCount,
  }
}

test("页面逐级进入，兄弟与孙级不混排，面包屑可跨级返回", () => {
  const f = fixture()
  let html = f.render()
  assert.doesNotMatch(html, /<button>单位<\/button>/)
  assert.match(html, /产品部/)
  assert.match(html, /研发部/)
  assert.doesNotMatch(html, /设计组/)
  assert.deepEqual(f.path(), ["单位"])
  f.click("产品部")
  html = f.render()
  assert.match(html, /设计组/)
  assert.doesNotMatch(html, /研发部/)
  f.click("设计组")
  html = f.render()
  assert.doesNotMatch(html, /产品部|研发部/)
  assert.deepEqual(f.path(), ["单位", "产品部", "设计组"])
  f.breadcrumb("unit:company")
  assert.match(f.render(), /研发部/)
  assert.doesNotMatch(f.render(), /设计组/)
  f.breadcrumb(null)
  assert.match(f.render(), /产品部/)
  assert.deepEqual(f.path(), ["单位"])
  f.click("返回")
  assert.equal(f.backCount(), 1)
})
