import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const root = new URL("../", import.meta.url)

test("XGUI Progress 对齐 WeUI 2.6.26 的结构、尺寸和语义色", async () => {
  const [progress, index] = await Promise.all([
    readFile(new URL("src/xgui/components/xgui-progress.tsx", root), "utf8"),
    readFile(new URL("src/xgui/index.ts", root), "utf8"),
  ])

  assert.match(progress, /backgroundColor: colors\.background0/)
  assert.match(progress, /backgroundColor: colors\.brand/)
  assert.match(progress, /bar: \{[\s\S]*?flex: 1,[\s\S]*?height: 3/)
  assert.match(progress, /operation: \{\s*marginLeft: 15/)
  assert.match(progress, /accessibilityRole="progressbar"/)
  assert.match(progress, /accessibilityValue=\{\{ max: 100, min: 0, now: normalizedValue \}\}/)
  assert.match(progress, /Math\.max\(0, Math\.min\(100, value\)\)/)
  assert.match(index, /XGUIProgress,[\s\S]*?type XGUIProgressProps/)
})
