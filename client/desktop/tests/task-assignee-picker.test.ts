import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as search from "../src/shared/user-search.ts"

const require = createRequire(import.meta.url)
const NativeCombobox = require("@base-ui/react/combobox").Combobox
const entry = pathToFileURL(require.resolve("@base-ui/react/combobox"))
const aria = source(new URL("./root/AriaCombobox.js", entry), ts.ScriptKind.JS)
const item = source(new URL("./item/ComboboxItem.js", entry), ts.ScriptKind.JS)
const page = source(
  new URL("../src/renderer/features/projects/project-task-panel.tsx", import.meta.url),
)
const dialog = source(
  new URL("../src/renderer/features/projects/project-task-dialog.tsx", import.meta.url),
)
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../src/renderer/features/projects/task-assignee-picker.tsx", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText

function source(path: URL, kind = ts.ScriptKind.TSX) {
  return ts.createSourceFile(
    path.pathname,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    kind,
  )
}

function find(tree: ts.Node, match: (node: ts.Node) => boolean): any {
  let found: ts.Node | undefined
  function visit(node: ts.Node) {
    if (match(node)) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(found, "未找到实际组件或库回调")
  return found
}

function bind(expression: string, scope: Record<string, unknown>) {
  const code = ts.transpileModule("const value = " + expression, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(scope), code + "\nreturn value;")(...Object.values(scope))
}

function nativeCallback(name: string, scope: Record<string, unknown>) {
  const declaration = find(
    aria,
    (node) => ts.isVariableDeclaration(node) && node.name.getText(aria) === name,
  )
  return bind(declaration.initializer.arguments[0].getText(aria), scope)
}

const nativeClick = find(
  item,
  (node) => ts.isVariableDeclaration(node) && node.name.getText(item) === "defaultProps",
)
  .initializer.properties.find(
    (node: ts.Node) => ts.isMethodDeclaration(node) && node.name.getText(item) === "onClick",
  )
  .getText(item)

function pickerElement(tree: ts.SourceFile) {
  return find(
    tree,
    (node) =>
      ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "TaskAssigneePicker",
  )
}

function attribute(tree: ts.SourceFile, name: string) {
  return pickerElement(tree).attributes.properties.find(
    (node: ts.Node) => ts.isJsxAttribute(node) && node.name.getText(tree) === name,
  )
}

const members = [
  {
    id: "u1",
    status: "active",
    displayName: "王明",
    name: "王明",
    nickname: "小王",
    email: "u1@example.test",
    phone: "13800000000",
  },
  {
    id: "u2",
    status: "active",
    displayName: "李华",
    name: "李华",
    nickname: "",
    email: "u2@example.test",
    phone: "",
  },
]

function fixture(
  options: {
    value?: string
    toggleOnReselect?: boolean
    disabled?: boolean
    members?: typeof members
    onChange?: (id: string) => void
  } = {},
) {
  let value = options.value ?? "u1",
    query = ""
  const changes: string[] = []
  const closes: boolean[] = []
  const jsx = (type: any, props: any) => ({ type, props })
  const module = { exports: {} as any }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "react")
        return {
          useMemo: (fn: Function) => fn(),
          useState: () => [
            query,
            (next: string) => {
              query = next
            },
          ],
        }
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
      if (name === "../../../shared/user-search") return search
      if (name === "@/lib/utils") return { cn: () => "" }
      return new Proxy({}, { get: (_target, key) => key })
    },
  })
  function render() {
    return module.exports.TaskAssigneePicker({
      targetId: "account",
      members: options.members ?? members,
      value,
      name: members.find((member) => member.id === value)?.displayName ?? "历史成员",
      theme: "light",
      disabled: options.disabled,
      toggleOnReselect: options.toggleOnReselect,
      emptyLabel: options.toggleOnReselect ? "所有负责人" : undefined,
      showEmptyOption: options.toggleOnReselect ? false : undefined,
      onChange: (id: string) => {
        changes.push(id)
        value = id
        options.onChange?.(id)
      },
    })
  }
  function select(id: string, eventType = "click") {
    const { children: _children, ...props } = render().props
    const root = NativeCombobox.Root(props).props
    const option = props.items.find((option: { id: string }) => option.id === id)
    assert.ok(option)
    // 执行安装版本的真实同值选择、值回调和关闭链，而不假定同值会触发 onValueChange。
    const setSelectedValue = nativeCallback("setSelectedValue", {
      onSelectedValueChange: root.onSelectedValueChange,
      selectedValue: root.selectedValue,
      setSelectedValueUnwrapped: () => {},
      selectionMode: "single",
      popupRef: { current: null },
      fillInputOnItemPress: false,
      single: true,
      store: { state: { inputInsidePopup: true } },
    })
    const handleSelection = nativeCallback("handleSelection", {
      _utils: { getTarget: () => null },
      selectionEventRef: { current: null },
      _createBaseUIEventDetails: {
        createChangeEventDetails: (reason: string, event: unknown) => ({
          reason,
          event,
          isCanceled: false,
        }),
      },
      _reasons: { REASONS: { itemPress: "item-press" } },
      multiple: false,
      setSelectedValue,
      setOpen: (open: boolean) => {
        closes.push(open)
        root.onOpenChange(open)
      },
    })
    const click = bind("({" + nativeClick + "}).onClick", {
      disabled: Boolean(root.disabled),
      readOnly: false,
      commitSelection: (event: unknown) => handleSelection(event, option),
    })
    click({ nativeEvent: { type: eventType } })
  }
  return {
    render,
    select,
    changes,
    closes,
    get value() {
      return value
    },
    get query() {
      return query
    },
  }
}

for (const eventType of ["click", "keydown"]) {
  test(eventType + "重复选择已选用户只取消一次，并关闭列表、恢复所有负责人", () => {
    const f = fixture({ toggleOnReselect: true })
    f.render().props.onInputValueChange("xiaowang")
    f.select("u1", eventType)
    assert.deepEqual(f.changes, [""])
    assert.deepEqual(f.closes, [false])
    assert.equal(f.value, "")
    assert.equal(f.query, "")
    const root = f.render()
    assert.equal(root.props.value, null)
    const trigger = root.props.children.find((child: any) => child.type === "ComboboxTrigger")
    assert.equal(trigger.props.children.props.children, "所有负责人")
  })
}

test("选择其他用户正常替换，不误取消", () => {
  const f = fixture({ toggleOnReselect: true })
  f.select("u2")
  assert.deepEqual(f.changes, ["u2"])
  assert.equal(f.render().props.value.id, "u2")
})

test("取消后可重新选择同一用户，多次操作保持单选", () => {
  const f = fixture({ value: "", toggleOnReselect: true })
  f.select("u1")
  f.select("u1")
  f.select("u1")
  assert.deepEqual(f.changes, ["u1", "", "u1"])
})

test("筛选列表只显示用户，没有所有负责人选项，空值清除仍保持受控", () => {
  const f = fixture({ value: "", toggleOnReselect: true })
  const root = f.render()
  assert.deepEqual(
    Array.from(root.props.items, (option: any) => option.id),
    ["u1", "u2"],
  )
  assert.equal(root.props.value, null)
  assert.equal(NativeCombobox.Root({ value: root.props.value }).props.selectedValue, null)
  f.select("u2")
  f.render().props.onValueChange(null, { reason: "input-clear" })
  assert.equal(f.render().props.value, null)
  f.select("u1")
  assert.deepEqual(f.changes, ["u2", "", "u1"])
  assert.equal(f.render().props.value.id, "u1")
})

test("无成员且未选用户时列表为空，仍显示所有负责人且保持受控", () => {
  const f = fixture({ value: "", members: [], toggleOnReselect: true })
  const root = f.render()
  assert.equal(root.props.items.length, 0)
  assert.equal(root.props.value, null)
  const trigger = root.props.children.find((child: any) => child.type === "ComboboxTrigger")
  assert.equal(trigger.props.children.props.children, "所有负责人")
})

test("非点选的同值更新不会意外取消筛选", () => {
  const f = fixture({ toggleOnReselect: true })
  const props = f.render().props
  props.onValueChange({ ...props.value }, { reason: "none" })
  assert.deepEqual(f.changes, ["u1"])
})

for (const toggleOnReselect of [undefined, false]) {
  test("任务详情保留负责人和未分配选项：" + toggleOnReselect, () => {
    const f = fixture({ toggleOnReselect })
    f.select("u1")
    assert.deepEqual(f.changes, ["u1"])
    assert.equal(f.value, "u1")
    const unassigned = f.render().props.items.find((option: any) => option.id === "")
    assert.equal(unassigned.name, "未分配")
    f.select("")
    assert.deepEqual(f.changes, ["u1", ""])
    assert.equal(f.render().props.value.id, "")
  })
}

test("禁用期间实际选项点击不触发选择或取消", () => {
  const f = fixture({ toggleOnReselect: true, disabled: true })
  f.select("u1")
  assert.deepEqual(f.changes, [])
  assert.deepEqual(f.closes, [])
  assert.equal(f.value, "u1")
})

test("已选用户不在成员候选中时位于首项，仍可取消", () => {
  for (const availableMembers of [[], members]) {
    const f = fixture({ value: "missing", members: availableMembers, toggleOnReselect: true })
    assert.equal(f.render().props.items[0].id, "missing")
    f.select("missing")
    assert.deepEqual(f.changes, [""])
    assert.equal(f.render().props.value, null)
  }
})

test("搜索匹配与选项按ID相等的规则保持不变", () => {
  const f = fixture({ toggleOnReselect: true })
  const props = f.render().props
  assert.equal(
    props.filter(
      props.items.find((option: { id: string }) => option.id === "u1"),
      "xiaowang",
    ),
    true,
  )
  assert.equal(props.isItemEqualToValue({ ...props.value }, props.value), true)
  props.onValueChange({ ...props.value }, { reason: "item-press" })
  assert.deepEqual(f.changes, [""])
})

test("只有任务筛选启用同项取消，取消会立即应用且保留状态、关键词等条件", () => {
  const toggle = attribute(page, "toggleOnReselect")
  assert.ok(toggle)
  assert.equal(toggle.initializer, undefined)
  assert.equal(attribute(dialog, "toggleOnReselect"), undefined)
  const showEmptyOption = attribute(page, "showEmptyOption")
  assert.ok(showEmptyOption)
  assert.equal(showEmptyOption.initializer.expression.kind, ts.SyntaxKind.FalseKeyword)
  assert.equal(attribute(dialog, "showEmptyOption"), undefined)
  const before = {
    assigneeUserIds: ["u1"],
    keyword: "修复",
    labels: ["Frontend"],
    statuses: ["todo", "in_progress"],
    priorities: [2],
  }
  let filters = before,
    applied: unknown
  const declaration = find(
    page,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "changeFilter",
  )
  const changeFilter = bind(declaration.getText(page), {
    filters,
    setFilters: (next: typeof before) => {
      filters = next
    },
    setAppliedFilters: (next: unknown) => {
      applied = next
    },
  })
  const onChange = bind(attribute(page, "onChange").initializer.expression.getText(page), {
    changeFilter,
  })
  const f = fixture({ toggleOnReselect: true, onChange })
  f.select("u1")
  assert.deepEqual(filters, { ...before, assigneeUserIds: [] })
  assert.deepEqual(applied, filters)
  assert.deepEqual(f.changes, [""])
  assert.deepEqual(before.assigneeUserIds, ["u1"])
})
