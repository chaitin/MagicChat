import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = readFileSync(new URL(
  "../src/xgui/components/xgui-gallery.tsx", import.meta.url
), "utf8")
const code = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

type MockGesture = {
  kind: string
  config: Record<string, number>
  handlers: Record<string, Function>
  [name: string]: any
}

function renderer() {
  const gestures: MockGesture[] = []
  const effects: Function[] = []
  const styles: Function[] = []
  const closes: boolean[] = []
  const swipes: string[] = []
  let saves = 0
  const exports: Record<string, any> = {}
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  function makeGesture(kind: string) {
    const gesture: MockGesture = { kind, config: {}, handlers: {} }
    for (const name of ["onBegin", "onStart", "onUpdate", "onEnd", "onTouchesDown"]) {
      gesture[name] = (callback: Function) => {
        gesture.handlers[name] = callback
        return gesture
      }
    }
    for (const name of ["minPointers", "minDistance", "numberOfTaps", "maxDuration", "maxDelay", "maxDistance"]) {
      gesture[name] = (value: number) => {
        gesture.config[name] = value
        return gesture
      }
    }
    gestures.push(gesture)
    return gesture
  }
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === "react") return { useEffect: (callback: Function) => effects.push(callback) }
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
      if (name === "react-native") return {
        Modal: "Modal", Pressable: "Pressable", View: "View", Image: "Image",
        StyleSheet: { create: (value: unknown) => value },
      }
      if (name === "react-native-gesture-handler") return {
        GestureDetector: "GestureDetector", GestureHandlerRootView: "GestureHandlerRootView",
        Gesture: {
          Pinch: () => makeGesture("Pinch"), Pan: () => makeGesture("Pan"), Tap: () => makeGesture("Tap"),
          Simultaneous: (...children: unknown[]) => ({ kind: "Simultaneous", children }),
          Exclusive: (...children: unknown[]) => ({ kind: "Exclusive", children }),
        },
      }
      if (name === "react-native-reanimated") return {
        __esModule: true, default: { View: "AnimatedView" },
        useSharedValue: (value: unknown) => ({ value }),
        useAnimatedStyle: (callback: Function) => { styles.push(callback); return callback },
        withTiming: (value: unknown) => value,
        runOnJS: (callback: Function) => callback,
      }
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) }
      if (name === "lucide-react-native") return { Download: "Download" }
      if (name === "expo-file-system") return {}
      if (name === "react-native-svg") return {}
      if (name === "@/xgui/components/xgui-loading-icon") return { XGUILoadingIcon: "LoadingIcon" }
      throw new Error(`unexpected import ${name}`)
    },
  })
  const node = exports.XGUIGallery({
    accessibilityLabel: "图片预览", open: true, source: { uri: "file:///cache/image.png" },
    onOpenChange: (open: boolean) => closes.push(open),
    onSave: () => { saves++ },
    onSwipeLeft: () => swipes.push("left"),
    onSwipeRight: () => swipes.push("right"),
  })
  for (const effect of effects) effect()
  function find(node: any, type: string): any {
    if (!node) return undefined
    if (node.type === type) return node
    for (const child of [node.props?.children].flat()) {
      const result = find(child, type)
      if (result) return result
    }
  }
  const pinch = gestures.find((gesture) => gesture.kind === "Pinch")!
  const pan = gestures.find((gesture) => gesture.kind === "Pan")!
  const single = gestures.find((gesture) => gesture.config.numberOfTaps === 1)!
  const double = gestures.find((gesture) => gesture.config.numberOfTaps === 2)!
  return {
    node, pinch, pan, single, double, closes, swipes,
    gesture: find(node, "GestureDetector").props.gesture,
    save: () => find(node, "Pressable").props.onPress(),
    saves: () => saves,
    transform: () => styles[0]().transform,
    begin: (pointers = 1) => pan.handlers.onBegin({ numberOfPointers: pointers }),
  }
}

function rejectMultitouch(gesture: MockGesture, pointers: number) {
  let failures = 0
  gesture.handlers.onTouchesDown({ numberOfTouches: pointers }, { fail: () => { failures++ } })
  return failures
}

function drag(view: ReturnType<typeof renderer>, x: number, y: number, success = true) {
  view.begin()
  view.pan.handlers.onStart()
  const event = { translationX: x, translationY: y }
  view.pan.handlers.onUpdate(event)
  view.pan.handlers.onEnd(event, success)
}

test("缩放和拖动同时工作，但优先于双击和单击，轻点具有时间及位移限制", () => {
  const view = renderer()
  assert.equal(view.gesture.kind, "Exclusive")
  assert.equal(view.gesture.children[0].kind, "Simultaneous")
  assert.equal(view.gesture.children[0].children[0], view.pinch)
  assert.equal(view.gesture.children[0].children[1], view.pan)
  assert.equal(view.gesture.children[1], view.double)
  assert.equal(view.gesture.children[2], view.single)
  assert.equal(view.single.config.maxDuration, 250)
  assert.equal(view.single.config.maxDistance, 8)
  assert.equal(view.double.config.maxDuration, 250)
  assert.equal(view.double.config.maxDelay, 250)
  assert.equal(view.double.config.maxDistance, 8)
  assert.equal(view.pan.config.minDistance, 8)
})

test("单指轻点在双击识别失败后关闭预览", () => {
  const view = renderer()
  view.begin()
  assert.equal(rejectMultitouch(view.single, 1), 0)
  view.double.handlers.onEnd({}, false)
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [false])
})

test("即使双指几乎不移动，也拒绝单击及双击；松开一指不会恢复关闭", () => {
  const view = renderer()
  view.begin()
  view.pan.handlers.onTouchesDown({ numberOfTouches: 2 })
  assert.equal(rejectMultitouch(view.single, 2), 1)
  assert.equal(rejectMultitouch(view.double, 2), 1)
  assert.equal(rejectMultitouch(view.single, 1), 0)
  view.double.handlers.onEnd({}, true)
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [])
  assert.equal(view.transform()[2].scale, 1)
})

test("双指缩放依次松开不关闭；下一轮单指轻点可以正常关闭", () => {
  const view = renderer()
  view.begin()
  view.pan.handlers.onTouchesDown({ numberOfTouches: 2 })
  view.pinch.handlers.onStart()
  view.pinch.handlers.onUpdate({ scale: 2 })
  view.pinch.handlers.onEnd()
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [])
  assert.equal(view.transform()[2].scale, 2)
  view.pan.handlers.onEnd({ translationX: 0, translationY: 0 }, true)
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [])
  view.begin()
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [false])
})

test("原尺寸双指向内缩放即使没有改变大小，也不能关闭预览", () => {
  const view = renderer()
  view.begin(2)
  view.pinch.handlers.onStart()
  view.pinch.handlers.onUpdate({ scale: 0.6 })
  view.pinch.handlers.onEnd()
  view.single.handlers.onEnd({}, true)
  assert.equal(view.transform()[2].scale, 1)
  assert.deepEqual(view.closes, [])
})

test("缩回原尺寸的双指动作不能被误识别为翻页或关闭", () => {
  const view = renderer()
  view.begin()
  view.double.handlers.onEnd({}, true)
  assert.equal(view.transform()[2].scale, 2)
  view.begin()
  view.pinch.handlers.onStart()
  view.pinch.handlers.onUpdate({ scale: 0.5 })
  view.pinch.handlers.onEnd()
  view.pan.handlers.onEnd({ translationX: -120, translationY: 0 }, true)
  view.single.handlers.onEnd({}, true)
  assert.equal(view.transform()[2].scale, 1)
  assert.deepEqual(view.swipes, [])
  assert.deepEqual(view.closes, [])
})

for (const [x, y] of [[0, 120], [80, 200], [80, 80], [20, 0]] as const) {
  test(`原尺寸移动(${x}, ${y})不翻页也不误触关闭`, () => {
    const view = renderer()
    drag(view, x, y)
    view.single.handlers.onEnd({}, true)
    assert.deepEqual(view.swipes, [])
    assert.deepEqual(view.closes, [])
    view.begin()
    view.single.handlers.onEnd({}, true)
    assert.deepEqual(view.closes, [false])
  })
}

for (const x of [-100, 100]) {
  test(`单指水平滑动${x}切换图片但不关闭`, () => {
    const view = renderer()
    drag(view, x, 10)
    view.single.handlers.onEnd({}, true)
    assert.deepEqual(view.swipes, [x < 0 ? "left" : "right"])
    assert.deepEqual(view.closes, [])
  })
}

test("放大后上下左右拖动只平移图片，保留连续拖动位置", () => {
  const view = renderer()
  view.begin()
  view.double.handlers.onEnd({}, true)
  drag(view, 120, 100)
  view.single.handlers.onEnd({}, true)
  assert.equal(view.transform()[0].translateX, 120)
  assert.equal(view.transform()[1].translateY, 100)
  assert.deepEqual(view.closes, [])
  assert.deepEqual(view.swipes, [])
  drag(view, 10, -20)
  assert.equal(view.transform()[0].translateX, 130)
  assert.equal(view.transform()[1].translateY, 80)
})

test("双击放大及恢复都不能同时触发单击关闭", () => {
  const view = renderer()
  for (const expected of [2, 1]) {
    view.begin()
    view.double.handlers.onEnd({}, true)
    view.single.handlers.onEnd({}, true)
    assert.equal(view.transform()[2].scale, expected)
    assert.deepEqual(view.closes, [])
  }
})

test("长按、取消的点击或取消的拖动均不关闭、不切图", () => {
  const view = renderer()
  view.begin()
  view.single.handlers.onEnd({}, false)
  drag(view, -100, 0, false)
  view.single.handlers.onEnd({}, true)
  assert.deepEqual(view.closes, [])
  assert.deepEqual(view.swipes, [])
})

test("缩放后保存和系统返回仍正常工作", () => {
  const view = renderer()
  view.begin()
  view.pinch.handlers.onStart()
  view.save()
  assert.equal(view.saves(), 1)
  assert.deepEqual(view.closes, [])
  view.node.props.onRequestClose()
  assert.deepEqual(view.closes, [false])
})
