import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")

test("聊天页进入和退出使用 iOS 风格横向过渡", async () => {
  const layout = await readFile(
    path.join(root, "src/app/(app)/_layout.tsx"),
    "utf8"
  )

  assert.match(
    layout,
    /name="conversation\/\[conversationId\]"[\s\S]*?options=\{\{ animation: "ios_from_right" \}\}/
  )
})

test("底部 Tab 激活色不叠加按压透明度", async () => {
  const tabbar = await readFile(
    path.join(root, "src/xgui/components/xgui-tabbar.tsx"),
    "utf8"
  )

  assert.match(tabbar, /const color = active \? colors\.brand : colors\.textPrimary/)
  assert.match(tabbar, /style=\{styles\.item\}/)
  assert.doesNotMatch(tabbar, /itemPressed|pressed &&|opacity: 0\.6/)
})

test("底部 Tab 使用原生淡入平滑复杂页面切换", async () => {
  const layout = await readFile(
    path.join(root, "src/app/(app)/(drawer)/(tabs)/_layout.tsx"),
    "utf8"
  )

  assert.match(layout, /screenOptions=\{\{\s+animation: "fade"/)
  assert.match(layout, /freezeOnBlur: true/)
  assert.doesNotMatch(layout, /detachInactiveScreens=\{false\}/)
  assert.doesNotMatch(layout, /freezeOnBlur: false/)
})
