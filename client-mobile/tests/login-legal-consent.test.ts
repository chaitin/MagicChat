import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const loginForm = await readFile(
  new URL("../src/features/auth/login-form.tsx", import.meta.url),
  "utf8"
)

test("登录前必须主动同意用户协议和隐私政策", () => {
  assert.match(loginForm, /accessibilityRole="checkbox"/)
  assert.match(loginForm, /accessibilityState=\{\{ checked: accepted \}\}/)
  assert.match(loginForm, /我已阅读并同意/)
  assert.match(loginForm, /https:\/\/jiying\.chat\/user-agreement\//)
  assert.match(loginForm, /https:\/\/jiying\.chat\/privacy-policy\//)
  assert.match(
    loginForm,
    /if \(!legalConsentAccepted\) \{[\s\S]*?message: "请先阅读并同意用户协议和隐私政策"[\s\S]*?modal: false[\s\S]*?type: "text"/
  )
  assert.match(
    loginForm,
    /showDisabledAppearance=\{!legalConsentAccepted\}/
  )
})

test("仅因协议未同意时登录按钮保留禁用外观但可以提示", () => {
  assert.match(
    loginForm,
    /const isSignInDisabled = !canSignIn \|\| isPending \|\| !connectionReady/
  )
  assert.match(
    loginForm,
    /showDisabledAppearance && !disabled[\s\S]*?backgroundColor: colors\.foreground5/
  )
})
