import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const formUrl = new URL("../src/features/auth/login-form.tsx", import.meta.url)
const hooksUrl = new URL("../src/data/auth/auth-hooks.ts", import.meta.url)

test("登录不重放已消费的验证码或在 Session 安装失败后重新认证", async () => {
  const [form, hooks] = await Promise.all([
    readFile(formUrl, "utf8"),
    readFile(hooksUrl, "utf8"),
  ])
  assert.doesNotMatch(form, /attemptLoginRequest/)
  assert.match(form, /await emailCodeLoginMutation\.mutateAsync\(/)
  for (const name of ["useLoginMutation", "useEmailCodeLoginMutation", "useRequestEmailCodeMutation"]) {
    const mutation = hooks.slice(hooks.indexOf(`export function ${name}(`)).split("\nexport function ")[0]
    assert.match(mutation, /retry: false/)
  }
})

test("发送验证码和登录在 React 更新 pending 前就阻止重复提交，并在失败后释放", async () => {
  const form = await readFile(formUrl, "utf8")
  for (const name of ["handleRequestEmailCode", "handleSignIn"]) {
    const handler = form.slice(form.indexOf(`async function ${name}(`)).split("\n  async function ")[0].split("\n  return (")[0]
    const guard = handler.indexOf("submissionInFlightRef.current ||")
    const lock = handler.indexOf("submissionInFlightRef.current = true")
    const request = handler.indexOf(".mutateAsync(")
    assert.ok(guard >= 0 && guard < lock && lock < request, name)
    assert.match(handler, /finally \{\s*submissionInFlightRef\.current = false/)
  }
})
