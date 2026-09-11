import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const screenUrl = new URL(
  "../src/features/servers/server-management-screen.tsx",
  import.meta.url
)

test("服务器管理使用统一的顶部返回按钮", async () => {
  const source = await readFile(screenUrl, "utf8")

  assert.match(
    source,
    /mode !== "default" \? <AppHeader onBackPress=\{\(\) => router\.back\(\)\} title="" \/>/
  )
  assert.match(
    source,
    /edges=\{mode === "default" \? \["top", "bottom"\] : \["bottom"\]\}/
  )
  assert.doesNotMatch(source, />\s*返回\s*<\/XGUIButton>/)
  assert.doesNotMatch(source, /取消添加账号|返回账号设置/)
})

test("未登录服务器选择页可检查并安装更新", async () => {
  const source = await readFile(screenUrl, "utf8")

  assert.match(source, /添加服务器[\s\S]*?<YStack items="center" mt="auto"[\s\S]*?mode === "default"[\s\S]*?版本 \{appUpdate\.installedVersion\.version\}[\s\S]*?>检查更新<[\s\S]*?XGUIFooter/)
  assert.match(source, /accessibilityLabel=\{`检查更新，当前版本 \$\{appUpdate\.installedVersion\.version\}`\}/)
  assert.match(source, /color: colors\.foreground2/)
  assert.match(source, /styles\.updateLink[\s\S]*?minHeight: 44/)
  assert.doesNotMatch(source, /installedVersion\.label|updateSeparator|> · </)
  assert.doesNotMatch(source, /XGUIListItem[\s\S]*?title="检查更新"/)
  assert.match(source, /message: "正在检查更新"/)
  assert.match(source, /title="发现新版本，是否更新？"/)
  assert.match(source, /<AppUpdateDialog[\s\S]*?status=\{appUpdate\.status\}/)
})
