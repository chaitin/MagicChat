import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { addInlineViewTextPackage } = require("../plugins/with-inline-view-text.js")
const native = readFileSync(new URL("../modules/font-fallback/android/src/main/java/cloud/baizhi/fontfallback/InlineViewTextPackage.java", import.meta.url), "utf8")

test("原生文本测量在换行前恢复View的DP占位，0.85/1/大字号和窄段落下不再重叠", () => {
  for (const fontScale of [0.85, 1, 1.3, 2]) {
    for (const density of [1, 2.75, 3]) {
      for (const maxWidth of [45, 90, 280]) {
        for (const requestedWidth of [20, 80.25, 350]) {
          const actualViewWidth = Math.min(requestedWidth, maxWidth)
          const roundedPixels = Math.ceil((actualViewWidth + 0.01) * density)
          const spPixels = Math.floor(roundedPixels * fontScale)
          const recoveredPixels = Math.ceil((spPixels + 1) / fontScale)
          assert.ok(recoveredPixels >= actualViewWidth * density)
          assert.ok(recoveredPixels - roundedPixels <= Math.ceil(1 / fontScale))
        }
      }
    }
  }
  assert.match(native, /Math\.ceil\(toSp\(span\.getWidth\(\) \+ 1, metrics\) \* metrics\.density\)/)
  assert.match(native, /Math\.round\(toSp\(span\.getHeight\(\), metrics\) \* metrics\.density\)/)
  assert.match(native, /getSpanStart\(span\)/)
  assert.match(native, /getSpanEnd\(span\)/)
  assert.match(native, /getSpanFlags\(span\)/)
  assert.match(native, /span\.getReactTag\(\), width, height/)
})

test("Android14使用系统逆转换处理非线性SP，保留默认文本管理器、原生选择和普通文本", () => {
  assert.match(native, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE/)
  assert.match(native, /TypedValue\.deriveDimension\(TypedValue\.COMPLEX_UNIT_SP/)
  assert.match(native, /pixels \/ metrics\.scaledDensity/)
  assert.match(native, /"RCTText", "RCTSelectableText"/)
  assert.match(native, /defaults\.createViewManager\(context, name\)/)
  assert.match(native, /manager\.getClass\(\)\.getConstructor\(ReactTextViewManagerCallback\.class\)/)
  assert.match(native, /getSpans\(0, text\.length\(\), TextInlineViewPlaceholderSpan\.class\)/)
  assert.doesNotMatch(native, /setText\(|setTypeface\(|setTextSize\(/)
})

test("Expo插件优先注册测量修正，重复预构建幂等，不覆盖其他原生配置", () => {
  const before = "PackageList(this).packages.apply {\n // 保留自定义包\n}\n"
  const patched = addInlineViewTextPackage(before)
  assert.ok(patched.includes("add(0, cloud.baizhi.fontfallback.InlineViewTextPackage())"))
  assert.ok(patched.includes("// 保留自定义包"))
  assert.equal(addInlineViewTextPackage(patched), patched)
  assert.throws(() => addInlineViewTextPackage("unrecognized layout"), /找不到/)
  const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"))
  assert.ok(app.expo.plugins.includes("./plugins/with-inline-view-text"))
})
