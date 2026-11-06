import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseTaskLink, taskLink } from "../../shared/task-links.ts"
import { parseContactLink } from "../../shared/contact-links.ts"

const projectId = "550e8400-e29b-41d4-a716-446655440000"
const taskId = "550e8400-e29b-41d4-a716-446655440001"
const url = taskLink({ projectId, taskId })
test("任务自有协议和旧链接严格解析，拒绝跨服务器、额外路径、编码绕过和非UUID", () => {
  for (const value of [url, "/projects/" + projectId + "?taskId=" + taskId])
    assert.deepEqual(parseTaskLink(value), { projectId, taskId })
  for (const value of [
    url + "?server=other",
    url + "#x",
    url + "/extra",
    url + "\n",
    " " + url,
    url.replace(projectId, "invalid"),
    url.replace("task/", "task@evil/"),
    url.replace(projectId, "%35" + projectId.slice(1)),
    "/projects/" + projectId + "?taskId=" + taskId + "&server=other",
  ])
    assert.equal(parseTaskLink(value), null, value)
  assert.throws(() => taskLink({ projectId: "invalid", taskId }))
})

test("桌面端任务卡片使用消息所属账号开窗，新旧地址均不交浏览器，失败有提示", async () => {
  const source = ts.createSourceFile(
    "body.tsx",
    readFileSync(
      new URL("../src/renderer/features/chat/message-bodies/rich-body.tsx", import.meta.url),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const declaration = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "CardBody",
  )!
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const opens: any[] = [],
    errors: any[] = []
  let fail = false,
    external = 0
  const exports = {} as any
  runInNewContext(code, {
    exports,
    parseContactLink,
    parseTaskLink,
    openContactEvent: "open-contact",
    useAnimatedToast: () => ({ showToast: (value: any) => errors.push(value) }),
    React: { createElement: (_type: any, props: any) => ({ props }) },
    window: {
      desktop: {
        taskWindows: {
          open: async (input: any) => {
            opens.push(input)
            return fail ? { ok: false, error: { message: "无权访问任务" } } : { ok: true }
          },
        },
        openWebLink: async () => {
          external++
          return { ok: true }
        },
      },
    },
  })
  for (const link of [url, "/projects/" + projectId + "?taskId=" + taskId]) {
    exports
      .CardBody({ title: "任务", description: "", url: link, targetId: "message-account" })
      .props.onClick()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(opens)),
    Array(2).fill({ targetId: "message-account", projectId, taskId }),
  )
  assert.equal(external, 0)
  fail = true
  exports
    .CardBody({ title: "任务", description: "", url, targetId: "message-account" })
    .props.onClick()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(errors.at(-1).title, "无权访问任务")
  exports
    .CardBody({
      title: "任务",
      description: "",
      url: url + "?server=other",
      targetId: "message-account",
    })
    .props.onClick()
  assert.equal(opens.length, 3)
  assert.equal(external, 0)
  assert.equal(errors.at(-1).title, "卡片链接格式不正确")
})
