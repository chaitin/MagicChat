import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import {
  canStartElasticOverscroll,
  getElasticBoundary,
  getElasticTranslation,
} from "@/components/layout/elastic-overscroll-model"

test("elastic overscroll recognizes top, bottom, middle and short content", () => {
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 0 }), "top")
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 250 }), "none")
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 500 }), "bottom")
  assert.equal(getElasticBoundary({ contentHeight: 300, viewportHeight: 500, offsetY: 0 }), "both")
})

test("elastic overscroll only translates outwards at a boundary", () => {
  const top = { contentHeight: 1000, viewportHeight: 500, offsetY: 0 }
  const bottom = { contentHeight: 1000, viewportHeight: 500, offsetY: 500 }
  const middle = { contentHeight: 1000, viewportHeight: 500, offsetY: 200 }
  assert.equal(getElasticTranslation(100, top), 35)
  assert.equal(getElasticTranslation(-100, top), 0)
  assert.equal(getElasticTranslation(-100, bottom), -35)
  assert.equal(getElasticTranslation(100, bottom), 0)
  assert.equal(getElasticTranslation(100, middle), 0)
})

test("elastic gesture yields to normal scrolling and only starts outwards", () => {
  const top = { contentHeight: 1000, viewportHeight: 500, offsetY: 0 }
  const bottom = { contentHeight: 1000, viewportHeight: 500, offsetY: 500 }
  const middle = { contentHeight: 1000, viewportHeight: 500, offsetY: 200 }
  assert.equal(canStartElasticOverscroll(20, top), true)
  assert.equal(canStartElasticOverscroll(-20, top), false)
  assert.equal(canStartElasticOverscroll(-20, bottom), true)
  assert.equal(canStartElasticOverscroll(20, bottom), false)
  assert.equal(canStartElasticOverscroll(20, middle), false)
  assert.equal(canStartElasticOverscroll(-20, middle), false)
})

test("elastic overscroll supports both directions for short content and clamps displacement", () => {
  const short = { contentHeight: 300, viewportHeight: 500, offsetY: 0 }
  assert.equal(getElasticTranslation(1000, short), 200)
  assert.equal(getElasticTranslation(-1000, short), -200)
})

test("卸载停止回弹动画，迟到的手势不能继续更新已销毁视图", () => {
  const text = readFileSync(new URL("../src/components/layout/elastic-overscroll.tsx", import.meta.url), "utf8")
  const code = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  let effect!: () => () => void
  let timings = 0
  const cancelled: { value: unknown }[] = []
  const handlers: Record<string, Function> = {}
  const pan = {
    manualActivation() { return this },
    onTouchesDown(callback: Function) { handlers.down = callback; return this },
    onTouchesMove(callback: Function) { handlers.move = callback; return this },
    onUpdate(callback: Function) { handlers.update = callback; return this },
    onFinalize(callback: Function) { handlers.finalize = callback; return this },
    simultaneousWithExternalGesture() { return this },
  }
  const exports = {} as { ElasticOverscroll: (props: unknown) => unknown }
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === "react") return { useEffect: (callback: typeof effect) => { effect = callback } }
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }) }
      if (name === "react-native") return { Platform: { OS: "android" }, StyleSheet: { create: (value: unknown) => value }, View: "View" }
      if (name === "react-native-gesture-handler") return { Gesture: { Pan: () => pan, Native: () => ({ simultaneousWithExternalGesture() {} }) }, GestureDetector: "GestureDetector" }
      if (name === "react-native-reanimated") return {
        __esModule: true, default: { View: "AnimatedView" },
        Easing: { out: (value: unknown) => value, cubic: "cubic" },
        useSharedValue: (value: unknown) => ({ value, set(next: unknown) { this.value = next } }),
        useAnimatedStyle: () => ({}),
        withTiming: (value: unknown) => { timings++; return value },
        cancelAnimation: (value: { value: unknown }) => cancelled.push(value),
      }
      if (name === "@/components/layout/elastic-overscroll-model") return { canStartElasticOverscroll, getElasticTranslation }
      throw new Error(`unexpected import ${name}`)
    },
  })
  exports.ElasticOverscroll({ children: () => null })
  const cleanup = effect()
  handlers.finalize()
  assert.equal(timings, 1)
  cleanup()
  assert.equal(cancelled.length, 1)
  handlers.update({ translationY: 100 })
  handlers.finalize()
  assert.equal(timings, 1)
  assert.equal(cancelled[0].value, 0)
  const secondCleanup = effect()
  handlers.finalize()
  assert.equal(timings, 2)
  secondCleanup()
})
