import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("更新下载使用 XGUI Dialog 并保留进度和取消", async () => {
  const dialog = await source("src/features/updates/app-update-dialog.tsx")
  assert.match(dialog, /import \{ XGUIDialog, XGUIProgress, useXGUITheme \} from "@\/xgui"/)
  assert.match(dialog, /<XGUIDialog[\s\S]*?label: "取消下载"[\s\S]*?status === "downloading"/)
  assert.match(dialog, /正在下载安装包[\s\S]*?\{percent\}%[\s\S]*?<XGUIProgress[\s\S]*?value=\{percent\}/)
  assert.doesNotMatch(dialog, /<Progress|\$color(?:3|10)|import \{[^\n]*(?:Dialog|Progress)[^\n]*\} from "tamagui"|正在打开系统安装器/)
})

test("检查更新保留模态 Loading，Toast Modal 使用完整窗口坐标", async () => {
  const [meScreen, serverScreen, toast] = await Promise.all([
    source("src/features/me/me-screen.tsx"),
    source("src/features/servers/server-management-screen.tsx"),
    source("src/xgui/components/xgui-toast.tsx"),
  ])

  for (const screen of [meScreen, serverScreen]) {
    assert.match(
      screen,
      /toast\.show\(\{ duration: 0, message: "正在检查更新", type: "loading" \}\)/
    )
    assert.match(
      screen,
      /message: "已经是最新版本", modal: false, type: "success"/
    )
  }
  assert.match(
    toast,
    /<Modal[\s\S]*?navigationBarTranslucent[\s\S]*?statusBarTranslucent/
  )
})

test("安装器跳转使用可清理的模态 XGUI Loading Toast", async () => {
  const hook = await source("src/features/updates/use-app-update.ts")
  assert.match(hook, /setStatus\("installing"\)[\s\S]*?message: "正在打开系统安装器"[\s\S]*?modal: true[\s\S]*?type: "loading"/)
  assert.match(hook, /await installAndroidUpdate\(fileUri\)[\s\S]*?hideInstallToast\(operation\)/)
  assert.match(hook, /function hideInstallToast\(operation: number\)[\s\S]*?installToastOperationRef\.current !== operation/)
  assert.match(hook, /function cancelUpdate\(\) \{[\s\S]*?const operation = operationRef\.current[\s\S]*?hideInstallToast\(operation\)/)
})

test("XGUI Dialog 支持承载下载进度内容", async () => {
  const dialog = await source("src/xgui/components/xgui-dialog.tsx")
  assert.match(dialog, /children\?: ReactNode/)
  assert.match(dialog, /\{children\}[\s\S]*?<\/View>/)
})
