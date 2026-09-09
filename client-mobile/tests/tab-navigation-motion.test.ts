import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")

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
