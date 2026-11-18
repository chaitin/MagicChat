import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = readFileSync(
  new URL("../src/renderer/components/avatar/contact-profile-popover.tsx", import.meta.url),
  "utf8",
)
const ast = ts.createSourceFile(
  "profile.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
function effect(marker: string, context: Record<string, unknown>) {
  let callback: ts.Node | undefined
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes(marker)
    )
      callback = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback)
  const code = ts.transpileModule("(" + callback.getText(ast) + ")()", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return runInNewContext(code, context) as () => void
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

test("组织及联系人通知只刷新当前账号，关闭时取消订阅", () => {
  let handler: (event: { targetId: string; domains: string[] }) => void = () => {}
  let revision = 0
  let cleared = 0
  let unsubscribed = false
  const cleanup = effect("accountData.onChanged", {
    open: true,
    targetId: "account",
    setOrganizationInfo: () => cleared++,
    setDataRevision: (update: (value: number) => number) => {
      revision = update(revision)
    },
    window: {
      desktop: {
        accountData: {
          onChanged: (cb: typeof handler) => {
            handler = cb
            return () => {
              unsubscribed = true
            }
          },
        },
      },
    },
  })
  handler({ targetId: "other", domains: ["organization"] })
  assert.equal(revision, 0)
  handler({ targetId: "account", domains: ["organization"] })
  handler({ targetId: "account", domains: ["contacts"] })
  assert.equal(revision, 2)
  assert.equal(cleared, 2)
  cleanup()
  assert.equal(unsubscribed, true)
})

test("请求失败清除旧组织资料，关闭后的迟到响应不能回填", async () => {
  for (const failure of ["denied", "network", "late"]) {
    let info: unknown = "old"
    const errors: unknown[] = []
    let resolve: (value: unknown) => void = () => {}
    const request = new Promise((r) => {
      resolve = r
    })
    const cleanup = effect("accountData.getOrganization(targetId)", {
      open: true,
      directory: { mode: "organization" },
      type: "user",
      targetId: "account",
      id: "user",
      key: "account:user:user",
      setOrganizationInfo: (value: unknown) => {
        info = value
      },
      showToast: (value: unknown) => errors.push(value),
      window: {
        desktop: {
          accountData: {
            getOrganization: () =>
              failure === "network" ? Promise.reject(new Error("offline")) : request,
            getOrganizationAssignments: async () => ({
              ok: true,
              data: { assignments: [], reporting: {} },
            }),
          },
        },
      },
    })
    assert.equal(info, null)
    if (failure === "late") cleanup()
    resolve(failure === "denied" ? { ok: false } : { ok: true, data: {} })
    await flush()
    assert.equal(info, null)
    assert.equal(errors.length, failure === "late" ? 0 : 1)
    cleanup()
  }
})
