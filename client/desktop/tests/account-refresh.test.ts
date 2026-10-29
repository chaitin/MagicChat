import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"
import { AuthFailure, isAuthenticationFailure } from "../src/shared/auth.ts"

const source = ts.createSourceFile(
  "auth-controller.ts",
  readFileSync(new URL("../src/main/auth-controller.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
)

function method(name: string, clearCookies: () => Promise<void>): Function {
  let text = ""
  function visit(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === name)
      text = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(text, `未找到方法 ${name}`)
  const code = ts.transpileModule(`class Subject { ${text} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  return new Function(
    "AuthFailure",
    "isAuthenticationFailure",
    "createAccountKey",
    "clearServerAuthCookies",
    `${code}\nreturn Subject.prototype[${JSON.stringify(name)}];`,
  )(AuthFailure, isAuthenticationFailure, () => "account", clearCookies)
}

function fixture(initialFailure?: Error) {
  let failure = initialFailure
  const effects: string[] = []
  const user = { id: "user" }
  const credential = { token: "test-token" }
  const active = {
    user: user as typeof user | null,
    credential: credential as typeof credential | null,
    server: { url: "https://example.test" },
    session: {},
  }
  const runtime = {
    refreshAll: async () => {
      if (failure) throw failure
    },
    initialize: async () => {
      if (failure) throw failure
    },
  }
  const controller = {
    initialized: Promise.resolve(),
    accountRuntime: runtime as typeof runtime | undefined,
    requireTarget: () => active,
    initializeAccountRuntime: method("initializeAccountRuntime", async () => {
      effects.push("cookies")
    }),
    destroyAccountRuntime() {
      effects.push("runtime")
      this.accountRuntime = undefined
    },
    revokeCredential: async () => {
      effects.push("revoke")
    },
    forgetStoredAccount: async () => {
      effects.push("stored-login")
    },
  }
  return {
    active,
    user,
    credential,
    runtime,
    controller,
    effects,
    refresh: () => method("refreshAll", async () => {}).call(controller, "target"),
    initialize: () => controller.initializeAccountRuntime.call(controller, active, runtime),
    recover: () => {
      failure = undefined
    },
  }
}

for (const failure of [
  new AuthFailure("network", "网络暂时不可用"),
  new AuthFailure("invalid_argument", "请求参数被服务器拒绝"),
  new AuthFailure("http_500", "服务器错误"),
  new AuthFailure("forbidden", "没有某项数据权限"),
  new Error("local database busy"),
]) {
  test(`刷新失败${failure.message}不撤销凭据、不清登录、不关闭账号运行时`, async () => {
    const h = fixture(failure)
    await assert.rejects(h.refresh(), (error) => error === failure)
    assert.equal(h.active.user, h.user)
    assert.equal(h.active.credential, h.credential)
    assert.equal(h.controller.accountRuntime, h.runtime)
    assert.deepEqual(h.effects, [])
    h.recover()
    assert.equal(await h.refresh(), null)
  })
}

for (const code of [
  "unauthorized",
  "not_authenticated",
  "invalid_session",
  "expired_session",
  "http_401",
]) {
  test(`刷新遇到真实认证失败${code}仍执行账号清理`, async () => {
    const failure = new AuthFailure(code, "登录已失效")
    const h = fixture(failure)
    await assert.rejects(h.refresh(), (error) => error === failure)
    assert.equal(h.active.user, null)
    assert.equal(h.active.credential, null)
    assert.equal(h.controller.accountRuntime, undefined)
    assert.deepEqual(new Set(h.effects), new Set(["runtime", "revoke", "cookies", "stored-login"]))
  })
}

test("首次初始化失败仍清理未成功建立的账号运行时", async () => {
  const failure = new AuthFailure("network", "初始化失败")
  const h = fixture(failure)
  await assert.rejects(h.initialize(), (error) => error === failure)
  assert.equal(h.controller.accountRuntime, undefined)
})

test("旧账号刷新失败不能关闭或清理已经切换的新账号运行时", async () => {
  const h = fixture(new AuthFailure("unauthorized", "旧凭据失效"))
  const next = { refreshAll: async () => {}, initialize: async () => {} }
  h.controller.accountRuntime = next
  await assert.rejects(
    h.controller.initializeAccountRuntime.call(
      h.controller,
      h.active,
      h.runtime,
      () => h.runtime.refreshAll(),
      false,
    ),
  )
  assert.equal(h.controller.accountRuntime, next)
  assert.deepEqual(h.effects, [])
})
