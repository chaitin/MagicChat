import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { buildDirectorySections } from "../src/features/contacts/contact-directory-model.ts"
import { getContactDisplayName } from "../src/domain/contacts/contact-display.ts"

type Element = { type: string; props: Record<string, any>; children: any[] }
const session = { id: "server", url: "https://example.test", userId: "self" }
const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8")
const React = { createElement: (type: string, props: Record<string, any>, ...children: any[]): Element => ({ type, props, children }) }

function load(file: string, globals: Record<string, unknown>, expose: string[] = []) {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const code = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join("\n")
  const compiled = ts.transpileModule(`${code}\n${expose.map((name) => `export { ${name} }`).join("\n")}`, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  const exports: any = {}
  runInNewContext(compiled, {
    exports, React, Set, View: "View", Text: "Text", FlatList: "FlatList", PageHeader: "PageHeader", ChevronLeft: "Back",
    HalfScreenSearchInput: "Search", HalfScreenSelectionRow: "SelectionRow", ContactDirectoryAvatar: "Avatar",
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useAuthenticatedSession: () => session,
    useSafeAreaInsets: () => ({ bottom: 16 }),
    useXGUITheme: () => ({ colors: { background0: "header-bg", brand5: "online" } }),
    getContactDisplayName, buildDirectorySections,
    ...globals,
  })
  return exports
}

function find(node: Element, type: string): Element {
  if (node.type === type) return node
  for (const child of node.children.flat()) {
    if (child && typeof child === "object") { const result = find(child, type); if (result) return result }
  }
  return undefined as unknown as Element
}

const user = (id: string, name: string, nickname = "") => ({
  id, name, nickname, avatar: "avatar", online: true, lastOnlineAt: null, email: "", phone: "", type: "user" as const,
})

test("创建群聊和邀请成员共用右侧选择行，32头像且保留昵称、在线状态与点击行为", () => {
  const component = load("features/conversation-details/contact-multi-select-screen.tsx", {}, ["ContactSelectionRow"])
  for (const selected of [false, true]) {
    let clicked = 0
    const row: Element = component.ContactSelectionRow({
      user: user("alice", "Alice", "Alicia"), selected, onPress: () => { clicked++ },
    })
    assert.equal(row.type, "SelectionRow")
    assert.equal(row.props.checkbox, true)
    assert.equal(row.props.checkboxPosition, "end")
    assert.equal(row.props.selected, selected)
    assert.equal(row.props.title, "Alicia")
    assert.equal(row.props.leading.type, "Avatar")
    assert.equal(row.props.leading.props.size, 32)
    assert.equal(row.props.leading.props.online, true)
    row.props.onPress()
    assert.equal(clicked, 1)
  }
})

test("创建与邀请保留初选、多选、搜索和排除本人/已有群成员的规则", () => {
  for (const title of ["选择联系人", "添加成员"]) {
    const states: any[] = []
    let cursor = 0
    let submitting = false
    let cancelled = 0
    const completed: string[][] = []
    const component = load("features/conversation-details/contact-multi-select-screen.tsx", {
      useState: (initial: any) => {
        const index = cursor++
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
        return [states[index], (next: any) => { states[index] = typeof next === "function" ? next(states[index]) : next }]
      },
      useMemo: (fn: Function) => fn(),
      useClientData: () => ({
        isReady: true, contactsError: null,
        contacts: { apps: [], groups: [], users: [user("SELF", "Self"), user("MEMBER", "Member"), user("alice", "Alice"), user("bob", "Bob")] },
      }),
    })
    const render = (): Element => {
      cursor = 0
      return component.ContactMultiSelectScreen({
        title, excludedUserIds: ["member"], initialSelectedUserIds: ["ALICE", "self", "member"], submitting,
        onCancel: () => { cancelled++ }, onComplete: (ids: string[]) => completed.push(ids),
      })
    }
    let tree = render()
    assert.equal(find(tree, "PageHeader").props.title, title)
    assert.equal(find(tree, "PageHeader").props.titleFontSize, 16)
    assert.equal(find(tree, "PageHeader").props.titleFontWeight, undefined)
    assert.equal(find(tree, "PageHeader").props.actionLabel, "完成(1)")
    let list = find(tree, "FlatList")
    assert.deepEqual(Array.from(list.props.data, (item: any) => item.id), ["alice", "bob"])
    list.props.renderItem({ item: list.props.data[1] }).props.onPress()
    tree = render()
    assert.equal(find(tree, "PageHeader").props.actionLabel, "完成(2)")
    find(tree, "Search").props.onChangeText("Bob")
    tree = render()
    list = find(tree, "FlatList")
    assert.deepEqual(Array.from(list.props.data, (item: any) => item.id), ["bob"])
    find(tree, "PageHeader").props.onActionPress()
    assert.deepEqual(Array.from(completed[0]), ["alice", "bob"])
    list.props.renderItem({ item: list.props.data[0] }).props.onPress()
    tree = render()
    assert.equal(find(tree, "PageHeader").props.actionLabel, "完成(1)")
    submitting = true
    tree = render()
    assert.equal(find(tree, "PageHeader").props.actionDisabled, true)
    find(tree, "PageHeader").props.onBackPress()
    assert.equal(cancelled, 1)
  }
})

test("联系人头像仅在显式指定时缩小，其他联系人页面保持默认44，用户和群头像同步缩放", () => {
  const component = load("features/contacts/contact-directory-avatar.tsx", { AppAvatar: "AppAvatar", GroupAvatar: "GroupAvatar" })
  for (const type of ["user", "group"]) {
    for (const size of [undefined, 32]) {
      const tree: Element = component.ContactDirectoryAvatar({ avatar: "avatar", name: "Alice", online: true, server: session, size, type })
      const expected = size ?? 44
      assert.equal(tree.props.style.width, expected)
      assert.equal(tree.props.style.height, expected)
      assert.equal(find(tree, type === "group" ? "GroupAvatar" : "AppAvatar").props.size, expected)
      const indicator = tree.children.find((child) => child?.type === "View")
      assert.equal(indicator.props.style[1].backgroundColor, "online")
    }
  }
})

test("创建群聊与邀请群成员入口都使用统一的联系人选择页", () => {
  assert.match(source("features/conversation-details/create-group-conversation-screen.tsx"), /<ContactMultiSelectScreen[\s\S]*initialSelectedUserIds=\{initialUserIds\}/)
  assert.match(source("features/conversation-details/add-group-members-screen.tsx"), /<ContactMultiSelectScreen[\s\S]*excludedUserIds=\{existingUserIds\}/)
})
