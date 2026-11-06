import { cardDisplayTitle } from "../../shared/card-title.ts"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { runInNewContext } from "node:vm"
import { parseContactLink } from "../../shared/contact-links.ts"
import { parseTaskLink } from "../../shared/task-links.ts"

const source = ts.createSourceFile(
  "rich.tsx",
  readFileSync(
    new URL("../src/renderer/features/chat/message-bodies/rich-body.tsx", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const declaration = source.statements.find(
  (n) => ts.isFunctionDeclaration(n) && n.name?.text === "CardBody",
)!
const code = ts.transpileModule(declaration.getText(source), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React,
  },
}).outputText
const exports = {} as any
runInNewContext(code, {
  exports,
  cardDisplayTitle,
  parseContactLink,
  parseTaskLink,
  HugeiconsIcon: "HugeiconsIcon",
  ContactIcon: "ContactIcon",
  CalendarCheckIcon: "CalendarCheckIcon",
  DotIcon: "DotIcon",
  useAnimatedToast: () => ({ showToast() {} }),
  React: {
    Fragment: "Fragment",
    createElement: (type: any, props: any, ...children: any[]) => ({
      type,
      props: { ...props, children },
    }),
  },
})
function nodes(n: any): any[] {
  if (Array.isArray(n)) return n.flatMap(nodes)
  return n && typeof n === "object" ? [n, ...nodes(n.props?.children)] : []
}
const id = "550e8400-e29b-41d4-a716-446655440000"
for (const [description, expected] of [
  ["姓名: 王明\n昵称: 小王\n手机号: 13800138000\n邮箱: user@example.com", "user@example.com"],
  ["姓名: 王明\n昵称: 小王\n手机号: 13800138000", "13800138000"],
  ["姓名: 王明\n昵称: 小王", "小王"],
  ["姓名: 王明", "王明"],
  ["new@example.com", "new@example.com"],
]) {
  test("名片单行摘要优先级：" + expected, () => {
    const root = exports.CardBody({
      targetId: "account",
      title: "联系人 - 小王",
      description,
      url: "jiying://contact/" + id,
    })
    assert.match(root.props.className, /flex.*items-center/)
    const all = nodes(root)
    const icon = all.find((n) => n.type === "HugeiconsIcon")
    assert.equal(icon.props.icon, "ContactIcon")
    assert.match(icon.props.className, /size-7 shrink-0/)
    const summary = all.find((n) => n.props?.title === expected)
    assert.ok(summary)
    assert.match(summary.props.className, /truncate/)
    assert.equal(summary.props.children[0], expected)
  })
}
test("新旧任务卡片使用任务图标和单行说明布局", () => {
  for (const url of ["jiying://task/" + id + "/" + id, "/projects/" + id + "?taskId=" + id]) {
    const description = "状态: 进行中\n负责人: 张三\n截止日期: 2026-07-20\n优先级: 高优先级"
    const root = exports.CardBody({ targetId: "account", title: "任务 - 发布", description, url })
    assert.match(root.props.className, /flex.*items-center/)
    const all = nodes(root)
    assert.equal(all.find((n) => n.type === "HugeiconsIcon").props.icon, "CalendarCheckIcon")
    assert.ok(all.some((n) => n.props?.children?.[0] === "进行中"))
    assert.ok(all.some((n) => n.props?.children?.[0] === "高优先级"))
    assert.ok(all.some((n) => n.props?.icon === "DotIcon"))
    assert.ok(!all.some((n) => n.props?.children?.includes(description)))
    assert.ok(!all.some((n) => n.props?.children?.includes("张三")))
    assert.ok(!all.some((n) => n.props?.className?.includes("line-clamp-3")))
  }
})

test("历史任务卡片缺少优先级时只显示状态，不显示分隔图标", () => {
  const root = exports.CardBody({
    targetId: "account",
    title: "任务",
    description: "状态: 进行中\n负责人: 张三",
    url: "jiying://task/" + id + "/" + id,
  })
  const all = nodes(root)
  assert.ok(all.some((n) => n.props?.children?.[0] === "进行中"))
  assert.ok(!all.some((n) => n.props?.icon === "DotIcon"))
})

test("各类实体卡片标题去掉类型前缀，普通卡片标题保持不变", () => {
  for (const [url, title, expected] of [
    ["jiying://task/" + id + "/" + id, "任务 - 发布", "发布"],
    ["/projects/" + id + "?taskId=" + id, "任务 - 发布", "发布"],
    ["jiying://contact/" + id, "联系人 - 小王", "小王"],
    ["jiying://contact/" + id, "小王", "小王"],
    ["jiying://app/" + id, "应用 - 助手", "助手"],
    ["jiying://group/" + id, "群聊 - 讨论", "讨论"],
    ["/projects/" + id, "项目 - 官网", "官网"],
    ["https://example.test", "任务 - 普通卡片", "任务 - 普通卡片"],
  ]) {
    const root = exports.CardBody({ targetId: "account", title, description: "", url })
    assert.ok(nodes(root).some((n) => n.props?.children?.[0] === expected))
  }
})

test("应用名片没有简介时显示暂无说明", () => {
  for (const description of ["", "  \n "]) {
    const root = exports.CardBody({
      targetId: "account",
      title: "应用",
      description,
      url: "jiying://app/" + id,
    })
    const summary = nodes(root).find((n) => n.props?.title === "暂无说明")
    assert.ok(summary)
    assert.equal(summary.props.children[0], "暂无说明")
  }
})

test("应用及群名片使用同款图标和单行说明，普通卡片保持原布局", () => {
  for (const kind of ["app", "group"]) {
    const root = exports.CardBody({
      targetId: "account",
      title: "标题",
      description: "说明",
      url: "jiying://" + kind + "/" + id,
    })
    assert.ok(nodes(root).some((n) => n.props?.icon === "ContactIcon"))
  }
  for (const url of ["https://example.test"]) {
    const root = exports.CardBody({ targetId: "account", title: "标题", description: "说明", url })
    assert.match(root.props.className, /grid/)
    assert.ok(nodes(root).some((n) => n.props?.className?.includes("line-clamp-3")))
    assert.ok(!nodes(root).some((n) => n.props?.icon === "ContactIcon"))
  }
})
