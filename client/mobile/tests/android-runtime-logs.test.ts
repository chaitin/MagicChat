import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const { addDrawableLogFilter, delegateSource } = require("../plugins/with-android-drawable-log-filter.js")
const application = `package cloud.baizhi.chat
class MainApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}`

test("原生日志过滤只在release启动时安装，重复prebuild不重复注入", () => {
  const result = addDrawableLogFilter(application)
  assert.equal(addDrawableLogFilter(result), result)
  assert.match(result, /if \(!BuildConfig\.DEBUG\)/)
  assert.ok(result.indexOf("setLoggingDelegate") < result.indexOf("loadReactNative"))
  assert.ok(result.includes("loadReactNative(this)"))
  assert.doesNotMatch(result, /setMinimumLoggingLevel|LogBox|StrictMode/)
  assert.throws(() => addDrawableLogFilter("class Unsupported {}"), /找不到/)
})

// 直接执行生成代码里JS/Kotlin共有语法的白名单表达式，不另写一份过滤规则。
const condition = /if \(([\s\S]+?)\) return/.exec(delegateSource)?.[1]
assert.ok(condition)
const ignores = new Function("tag", "message", `return (${condition});`)
const prefix = "Don't know how to round that drawable: "

test("只忽略Fresco空占位及动图的已知圆角提示", () => {
  assert.equal(ignores("WrappingUtils", prefix + "com.facebook.react.views.image.ReactImageDownloadListener$EmptyDrawable@abc"), true)
  assert.equal(ignores("WrappingUtils", prefix + "com.facebook.fresco.animation.drawable.AnimatedDrawable2@123"), true)
})

test("未知图片警告、其他模块、资源未关闭及真实异常不能被白名单吞掉", () => {
  assert.equal(ignores("OtherModule", prefix + "com.facebook.fresco.animation.drawable.AnimatedDrawable2@123"), false)
  assert.equal(ignores("WrappingUtils", prefix + "com.example.UnknownDrawable@123"), false)
  assert.equal(ignores("WrappingUtils", "Image decoding failed"), false)
  assert.equal(ignores("System", "A resource failed to call close."), false)
  assert.equal(ignores("Reanimated", "synchronouslyUpdateUIProps failed"), false)
  assert.equal((delegateSource.match(/override fun /g) ?? []).length, 1)
  assert.match(delegateSource, /override fun w\(tag: String, message: String\)/)
  assert.match(delegateSource, /FLogDefaultLoggingDelegate\.getInstance\(\)\.w\(tag, message\)/)
  assert.match(delegateSource, /LoggingDelegate by/)
})

test("pnpm依赖或补丁变化会刷新原生自动链接缓存，不继续使用旧原生库", () => {
  const { addPnpmAutolinkingInputs } = require("../plugins/with-pnpm-autolinking-cache.js")
  const original = "ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)"
  const result = addPnpmAutolinkingInputs(original)
  assert.equal(addPnpmAutolinkingInputs(result), result)
  assert.match(result, /rootDir\.parentFile/)
  for (const input of ["package.json", "react-native.config.js", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    assert.ok(result.includes(`"${input}"`))
  }
  assert.throws(() => addPnpmAutolinkingInputs("unsupported"), /找不到/)
  const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"))
  assert.ok(config.expo.plugins.includes("./plugins/with-pnpm-autolinking-cache"))
})

test("Reanimated补丁在更新前跳过失效及预分配视图，保留其他真实异常日志", () => {
  const native = readFileSync(new URL("../node_modules/react-native-reanimated/android/src/main/java/com/swmansion/reanimated/NativeProxy.kt", import.meta.url), "utf8")
  const update = native.slice(native.indexOf("fun synchronouslyUpdateUIProps("), native.indexOf("fun setGestureState("))
  assert.ok(update.indexOf("resolveView(viewTag)") < update.indexOf("updatePropsSynchronouslyMethod.invoke"))
  assert.match(update, /catch \(_: IllegalViewOperationException\) \{\s*null/)
  assert.match(update, /if \(view == null\) return@parse/)
  assert.match(update, /catch \(e: Exception\) \{\s*Log\.w\("Reanimated"/)
  assert.match(update, /mFabricUIManager\.synchronouslyUpdateViewOnUIThread\(viewTag, props\)/)
  const workspace = readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8")
  assert.match(workspace, /react-native-reanimated@4\.5\.0: patches\/react-native-reanimated@4\.5\.0\.patch/)
  const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"))
  assert.ok(config.expo.plugins.includes("./plugins/with-android-drawable-log-filter"))
})
