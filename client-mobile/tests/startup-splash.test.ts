import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")

test("冷启动验证凭据后先进入本地界面并后台同步", async () => {
  const [rootLayout, authProvider, messagesScreen] = await Promise.all([
    readFile(path.join(root, "src/app/_layout.tsx"), "utf8"),
    readFile(path.join(root, "src/providers/auth-provider.tsx"), "utf8"),
    readFile(path.join(root, "src/features/messages/messages-screen.tsx"), "utf8"),
  ])

  assert.match(rootLayout, /MINIMUM_SPLASH_TIME_MS = 500/)
  assert.doesNotMatch(rootLayout, /isMessageBootstrapComplete/)
  assert.match(authProvider, /accountStore\.getCredential\(account\.id\)/)
  assert.match(authProvider, /queryClient\.setQueryData\(queryKeys\.currentUser\(target\)/)
  assert.match(authProvider, /const \{ completion, preparation \} = beginBootstrap\(account\)/)
  assert.match(authProvider, /publish\(next, snapshot, "authenticated"\)/)
  assert.match(authProvider, /queryClient\.invalidateQueries\(\{/)
  assert.match(authProvider, /void completion\.catch\(\(\) => undefined\)/)
  assert.ok(
    authProvider.indexOf('publish(next, snapshot, "authenticated")') <
      authProvider.indexOf("void completion.catch(() => undefined)")
  )
  assert.match(messagesScreen, /requestIdleCallback\(\(\) => \{/)
  assert.match(messagesScreen, /cancelIdleCallback\(task\)/)
  assert.doesNotMatch(messagesScreen, /InteractionManager/)
})

test("初始化页与原生 Splash 使用相同主题背景", async () => {
  const [initScreen, colors, appConfig] = await Promise.all([
    readFile(path.join(root, "src/features/bootstrap/init-screen.tsx"), "utf8"),
    readFile(path.join(root, "src/xgui/theme/colors.ts"), "utf8"),
    readFile(path.join(root, "app.json"), "utf8"),
  ])
  const splash = JSON.parse(appConfig).expo.plugins.find(
    (plugin: unknown) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen"
  )[1]

  assert.match(initScreen, /backgroundColor: colors\.background0/)
  assert.doesNotMatch(initScreen, /#04C9BD/)
  assert.match(colors, new RegExp(`background0: "${splash.backgroundColor}"`))
  assert.match(
    colors,
    new RegExp(`background0: "${splash.dark.backgroundColor}"`)
  )
})
