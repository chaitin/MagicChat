import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const loginFormUrl = new URL(
  "../src/features/auth/login-form.tsx",
  import.meta.url
)
const loginScreenUrl = new URL(
  "../src/features/auth/login-screen.tsx",
  import.meta.url
)

test("登录操作保持键盘和输入焦点", async () => {
  const [formSource, screenSource] = await Promise.all([
    readFile(loginFormUrl, "utf8"),
    readFile(loginScreenUrl, "utf8"),
  ])

  assert.match(
    screenSource,
    /<KeyboardAwareScreen[\s\S]*?keyboardShouldPersistTaps="always"/
  )
  assert.match(formSource, /const areInputsUnavailable = isCredentialsLoading/)
  assert.match(
    formSource,
    /message: "正在登录",\s*modal: false,\s*type: "loading"/
  )
  assert.equal(formSource.match(/submitBehavior="submit"/g)?.length, 2)
})

test("登录安装激活成功后直接进入消息页", async () => {
  const screenSource = await readFile(loginScreenUrl, "utf8")

  assert.match(
    screenSource,
    /function handleLoginSuccess\(\) \{\s*markServerAsRecentlyUsed\(loginServer\.id\)\s*hideToast\(\)\s*router\.replace\("\/messages"\)\s*return Promise\.resolve\(\)\s*\}/
  )
  assert.doesNotMatch(
    screenSource,
    /beginSignIn|commitSignIn|rollbackSignIn|runLoginBootstrap|waitUntilReady/
  )
})
