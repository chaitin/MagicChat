import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const root = path.resolve(import.meta.dirname, "..")

test("Popover 完成锚点测量后才挂载 Portal 内容", async () => {
  const source = await readFile(
    path.join(root, "src/xgui/components/xgui-popover-menu.tsx"),
    "utf8"
  )

  assert.match(source, /<Portal stackZIndex=\{100_000\}>/)
  assert.doesNotMatch(source, /<Modal|animationType="none"/)
  assert.match(source, /setLayout\([\s\S]*?setRendered\(true\)/)
  assert.match(source, /if \(!rendered \|\| !layout\) return null/)
  assert.match(source, /useNativeDriver: true/)
  assert.match(source, /animationRef\.current\?\.stop\(\)/)
})

test("Popover 支持关闭动画、Android 返回键和轻量位移", async () => {
  const source = await readFile(
    path.join(root, "src/xgui/components/xgui-popover-menu.tsx"),
    "utf8"
  )

  assert.match(source, /BackHandler\.addEventListener\("hardwareBackPress"/)
  assert.match(source, /toValue: 0,[\s\S]*?setRendered\(false\)/)
  assert.match(source, /outputRange: \[isBottom \? -4 : 4, 0\]/)
  assert.match(source, /needsOffscreenAlphaCompositing/)
  assert.match(source, /renderToHardwareTextureAndroid/)
  assert.match(source, /shouldRasterizeIOS/)
  assert.match(source, /progress\.setValue\(0\.01\)/)
  assert.match(
    source,
    /requestAnimationFrame\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => \{/
  )
})
