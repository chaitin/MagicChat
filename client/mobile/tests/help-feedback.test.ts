import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const appConfig = await readFile(
  new URL("../src/config/app-config.ts", import.meta.url),
  "utf8"
)
const meScreen = await readFile(
  new URL("../src/features/me/me-screen.tsx", import.meta.url),
  "utf8"
)

test("我的页面在帮助与反馈上方提供关于即应入口", () => {
  assert.match(appConfig, /websiteUrl: "https:\/\/jiying\.chat\/"/)
  assert.match(
    meScreen,
    /title="关于即应"[\s\S]*?title="帮助与反馈"/
  )
  assert.match(meScreen, /Linking\.openURL\(appConfig\.websiteUrl\)/)
  assert.match(meScreen, /无法打开即应官网/)
})

test("我的页面提供可用的帮助与反馈入口", () => {
  assert.match(
    appConfig,
    /helpCenterUrl: "https:\/\/jiying\.docs\.baizhi\.cloud\/"/
  )
  assert.match(meScreen, /title="帮助与反馈"/)
  assert.match(meScreen, /Linking\.openURL\(appConfig\.helpCenterUrl\)/)
  assert.match(meScreen, /无法打开帮助中心/)
})
