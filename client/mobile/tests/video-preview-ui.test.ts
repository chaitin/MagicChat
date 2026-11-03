import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

import { buildVideoPreviewScope, buildVideoPreviewHref, parseVideoPreviewParams } from "@/navigation/video-preview"
import { formatFileSize } from "@/domain/messages/message-presenter"

const session = { id: "server", url: "https://server.example.test", userId: "user" }
const source = { fileId: "video-1", name: "clip.mp4", contentType: "video/mp4", sizeBytes: 1024 }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function harness(file = "../src/features/video-preview/video-preview-screen.tsx") {
  let cursor = 0
  let pending: (() => void)[] = []
  const slots: any[] = []
  const requests: any[] = []
  const pushes: any[] = []
  const diagnostics: unknown[][] = []
  const auth = { session: session as typeof session | null, generation: 1, phase: "authenticated" }
  const environment = { focused: true, appState: "active", status: "readyToPlay", backs: 0, plays: 0, pauses: 0 }
  let appStateListener = (_value: string) => {}
  const player = {
    get status() { return environment.status },
    play: () => environment.plays++,
    pause: () => environment.pauses++,
  }
  const react = {
    useCallback: (fn: Function) => fn,
    useMemo: (fn: Function) => fn(),
    useRef(value: unknown) {
      const index = cursor++
      slots[index] ??= { current: value }
      return slots[index]
    },
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial
      return [slots[index], (value: any) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value
      }]
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((dep, position) => !Object.is(dep, previous.deps[position]))) {
        pending.push(() => {
          previous?.cleanup?.()
          slots[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
  const router = {
    canGoBack: () => true,
    back: () => environment.backs++,
    replace: (value: unknown) => pushes.push(value),
    push: (value: unknown) => pushes.push(value),
  }
  const exports: Record<string, any> = {}
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const suffix = file.endsWith("video-preview-screen.tsx")
    ? "\nexports.testComponents = { AuthenticatedVideoPreview, DownloadedVideo };"
    : ""
  runInNewContext(code + suffix, {
    exports, AbortController, Error,
    console: {
      warn: (...args: unknown[]) => diagnostics.push(args),
      error: (...args: unknown[]) => diagnostics.push(args),
    },
    require(name: string) {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
      }
      if (name === "expo") return { useEvent: () => ({ status: environment.status }) }
      if (name === "expo-router") return {
        Redirect: "Redirect",
        useRouter: () => router,
        useIsFocused: () => environment.focused,
        useLocalSearchParams: () => (buildVideoPreviewHref(source as any, buildVideoPreviewScope(session, 1)) as any).params,
        useFocusEffect: (effect: () => void) => react.useEffect(() => environment.focused ? effect() : undefined, [environment.focused]),
      }
      if (name === "expo-navigation-bar") return { NavigationBar: "NavigationBar" }
      if (name === "expo-status-bar") return { StatusBar: "StatusBar" }
      if (name === "expo-video") {
        if (!file.endsWith("video-preview-screen.tsx")) throw new Error("聊天卡片不能加载播放器")
        return { VideoView: "VideoView", useVideoPlayer: (_uri: string, setup: Function) => { setup(player); return player } }
      }
      if (name === "lucide-react-native") return { X: "X", Play: "Play" }
      if (name === "react-native") return {
        AppState: { get currentState() { return environment.appState }, addEventListener: (_name: string, listener: typeof appStateListener) => { appStateListener = listener; return { remove() {} } } },
        Pressable: "Pressable", View: "View",
        StyleSheet: { create: (styles: unknown) => styles, absoluteFill: { position: "absolute" } },
      }
      if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }
      if (name === "@/components/mi-sans-text") return { Text: "Text" }
      if (name === "@/data/resources") return {
        ensureAttachmentResource: (target: unknown, reference: unknown, options: any) => {
          let resolve!: (value: unknown) => void
          let reject!: (error: unknown) => void
          const promise = new Promise((res, rej) => { resolve = res; reject = rej })
          requests.push({ target, reference, options, resolve, reject })
          return promise
        },
      }
      if (name === "@/domain/messages/message-presenter") return { formatFileSize }
      if (name === "@/navigation/video-preview") return { buildVideoPreviewScope, buildVideoPreviewHref, parseVideoPreviewParams }
      if (name === "@/providers/auth-provider") return { useAuth: () => auth }
      if (name === "@/xgui") return {
        XGUIButton: "XGUIButton", XGUILoadingIcon: "XGUILoadingIcon", XGUIProgress: "XGUIProgress",
        useXGUITheme: () => ({ colors: { background4: "bg-4", background2: "bg-2" } }),
      }
      throw new Error(`unexpected import ${name}`)
    },
  })
  return {
    api: exports, components: exports.testComponents, requests, pushes, auth, environment, diagnostics,
    background(value: string) { environment.appState = value; appStateListener(value) },
    render(component: Function, props?: unknown) {
      cursor = 0
      pending = []
      return component(props)
    },
    commit() { pending.forEach((effect) => effect()); pending = [] },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()) },
    strictReplay() {
      slots.forEach((slot, index) => {
        if (slot?.deps) { slot.cleanup?.(); slots[index] = undefined }
      })
    },
  }
}

function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return []
  if (Array.isArray(node)) return node.flatMap(nodes)
  return [node, ...nodes(node.props?.children)]
}
function text(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (!node || typeof node !== "object") return ""
  return Array.isArray(node) ? node.map(text).join("") : text(node.props?.children)
}
const props = { session, source }
const resource = { uri: "file:///cache/video.mp4", sizeBytes: 1024, identity: "video", source: "cache" }

test("聊天视频卡片仅显示bg-4和bg-2播放按钮，长按不会误打开预览", () => {
  const h = harness("../src/features/conversation/messages/message-video.tsx")
  let presses = 0, longPresses = 0
  const node = h.render(h.api.MessageVideo, { roundedBottom: true, onPress: () => presses++, onLongPress: () => longPresses++ })
  h.commit()
  assert.equal(h.requests.length, 0)
  assert.equal(node.props.style.at(-1).backgroundColor, "bg-4")
  const icon = nodes(node).find((item) => item.type === "Play")
  assert.equal(icon.props.fill, "bg-2")
  assert.equal(icon.props.size, 28)
  node.props.onPressIn()
  node.props.onLongPress()
  node.props.onPress()
  assert.equal(longPresses, 1)
  assert.equal(presses, 0)
  node.props.onPressIn()
  node.props.onPress()
  assert.equal(presses, 1)
})

test("下载异常中的临时URL和令牌不写入日志，也不显示到页面", async () => {
  const h = harness()
  h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  h.requests[0].reject(new Error("network https://media.example.test/video?token=fixture-secret"))
  await flush()
  const tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.match(text(tree), /视频下载失败/)
  assert.doesNotMatch(text(tree), /media\.example\.test|fixture-secret/)
  assert.deepEqual(h.diagnostics, [])
  h.unmount()
})

test("进入预览才下载，显示真实进度，完成后才挂载播放器", async () => {
  const h = harness()
  let tree = h.render(h.components.AuthenticatedVideoPreview, props)
  h.commit()
  assert.equal(h.requests.length, 1)
  assert.equal(nodes(tree).some((node) => node.type === h.components.DownloadedVideo), false)
  const request = h.requests[0]
  assert.equal(request.target, session)
  assert.equal(request.reference.kind, "video")
  request.options.onDownloadStart()
  request.options.onProgress({ bytesWritten: 512, totalBytes: 1024 })
  tree = h.render(h.components.AuthenticatedVideoPreview, props)
  h.commit()
  assert.equal(nodes(tree).find((node) => node.type === "XGUIProgress").props.value, 50)
  assert.match(text(tree), /50%/)
  assert.equal(nodes(tree).some((node) => node.type === h.components.DownloadedVideo), false)
  request.resolve(resource)
  await flush()
  tree = h.render(h.components.AuthenticatedVideoPreview, props)
  h.commit()
  assert.equal(nodes(tree).find((node) => node.type === h.components.DownloadedVideo).props.resource, resource)
})

test("未知总大小只显示已下载大小，不显示伪造的百分比", () => {
  const h = harness()
  h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  h.requests[0].options.onProgress({ bytesWritten: 512 })
  const tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.equal(nodes(tree).some((node) => node.type === "XGUIProgress"), false)
  assert.match(text(tree), /512/)
  assert.doesNotMatch(text(tree), /%/)
  h.unmount()
})

test("关闭按钮立即取消下载，迟到的完成结果不能启动播放", async () => {
  const h = harness()
  const tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  nodes(tree).find((node) => node.props?.accessibilityLabel === "关闭视频预览").props.onPress()
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(h.environment.backs, 1)
  h.requests[0].resolve(resource)
  await flush()
  const after = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.equal(nodes(after).some((node) => node.type === h.components.DownloadedVideo), false)
})

test("退后台或失焦取消下载，回前台不偷偷重启，只在用户重试后开始", () => {
  for (const background of [true, false]) {
    const h = harness()
    h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
    if (background) h.background("background")
    else h.environment.focused = false
    h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
    assert.equal(h.requests[0].options.signal.aborted, true)
    if (background) h.background("active")
    else h.environment.focused = true
    let tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
    assert.equal(h.requests.length, 1)
    assert.match(text(tree), /下载已中断/)
    nodes(tree).find((node) => node.type === "XGUIButton").props.onPress()
    tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
    assert.equal(h.requests.length, 2)
    h.unmount()
    assert.equal(h.requests[1].options.signal.aborted, true)
  }
})

test("下载失败保留页内重试，开发模式的effect重放不会卡住下载", async () => {
  const h = harness()
  h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  h.strictReplay()
  h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.equal(h.requests[0].options.signal.aborted, true)
  assert.equal(h.requests.length, 2)
  h.requests[1].reject(new Error("network"))
  await flush()
  const tree = h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.match(text(tree), /下载失败/)
  nodes(tree).find((node) => node.type === "XGUIButton").props.onPress()
  h.render(h.components.AuthenticatedVideoPreview, props); h.commit()
  assert.equal(h.requests.length, 3)
  h.unmount()
})

test("视频在播放与退出时固定使用textureView，避免切换原生渲染层", () => {
  const h = harness()
  for (const active of [true, false]) {
    const tree = h.render(h.components.DownloadedVideo, { active, resource, onRetry() {} }); h.commit()
    const video = nodes(tree).find((node) => node.type === "VideoView")
    assert.equal(video.props.surfaceType, "textureView")
  }
  assert.equal(h.environment.plays, 1)
  assert.ok(h.environment.pauses > 0)
  assert.equal(h.requests.length, 0)
  h.unmount()
})

test("播放页隐藏全屏和设置按钮但保留原生播放控制", () => {
  const h = harness()
  const tree = h.render(h.components.DownloadedVideo, { active: true, resource, onRetry() {} }); h.commit()
  const video = nodes(tree).find((node) => node.type === "VideoView")
  assert.equal(video.props.fullscreenOptions.enable, false)
  assert.equal(video.props.buttonOptions.showSettings, false)
  assert.equal(video.props.nativeControls, true)
  h.unmount()
})

test("播放器只在就绪且前台时自动播放一次，缓冲变化不强制暂停，后台返回不自动出声", () => {
  const h = harness()
  const playingProps = { active: true, resource, onRetry() {} }
  h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(h.environment.plays, 1)
  h.environment.status = "loading"
  h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(h.environment.pauses, 0)
  h.environment.status = "readyToPlay"
  h.render(h.components.DownloadedVideo, { ...playingProps, active: false }); h.commit()
  assert.ok(h.environment.pauses > 0)
  h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(h.environment.plays, 1)
  h.unmount()
  assert.equal(h.requests.length, 0)
})

test("播放结束进入idle后不显示准备播放，也不自动重播", () => {
  const h = harness()
  const playingProps = { active: true, resource, onRetry() {} }
  h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(h.environment.plays, 1)

  h.environment.status = "idle"
  let tree = h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(nodes(tree).some((node) => node.type === "XGUILoadingIcon"), false)
  assert.doesNotMatch(text(tree), /正在准备播放/)
  assert.equal(h.environment.plays, 1)

  const video = nodes(tree).find((node) => node.type === "VideoView")
  assert.equal(video.props.nativeControls, true)
  video.props.player.play()
  h.environment.status = "loading"
  tree = h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(nodes(tree).some((node) => node.type === "XGUILoadingIcon"), true)
  h.environment.status = "readyToPlay"
  tree = h.render(h.components.DownloadedVideo, playingProps); h.commit()
  assert.equal(nodes(tree).some((node) => node.type === "XGUILoadingIcon"), false)
  assert.equal(h.environment.plays, 2)
  assert.equal(h.requests.length, 0)
  h.unmount()
})

test("准备播放提示只在loading时出现，初始idle和暂停不误显示", () => {
  for (const status of ["idle", "loading", "readyToPlay"]) {
    const h = harness()
    h.environment.status = status
    const tree = h.render(h.components.DownloadedVideo, { active: false, resource, onRetry() {} }); h.commit()
    assert.equal(nodes(tree).some((node) => node.type === "XGUILoadingIcon"), status === "loading")
    assert.equal(text(tree).includes("正在准备播放"), status === "loading")
    h.unmount()
  }
})

test("解码失败只提供重试播放，不重新下载文件", () => {
  const h = harness()
  h.environment.status = "error"
  let retries = 0
  const tree = h.render(h.components.DownloadedVideo, { active: true, resource, onRetry: () => retries++ }); h.commit()
  assert.match(text(tree), /视频已下载，但无法播放/)
  nodes(tree).find((node) => node.type === "XGUIButton").props.onPress()
  assert.equal(retries, 1)
  assert.equal(h.requests.length, 0)
  assert.equal(h.environment.plays, 0)
})

test("账号或认证世代变更立即离开预览，不使用新账号下载旧视频", () => {
  const h = harness()
  let tree = h.render(h.api.VideoPreviewScreen)
  assert.equal(tree.type, h.components.AuthenticatedVideoPreview)
  h.auth.phase = "switching"
  tree = h.render(h.api.VideoPreviewScreen)
  assert.equal(tree.type, "Redirect")
  h.auth.phase = "authenticated"
  h.auth.generation++
  tree = h.render(h.api.VideoPreviewScreen)
  assert.equal(tree.type, "Redirect")
  assert.equal(tree.props.href, "/messages")
  h.auth.session = null
  tree = h.render(h.api.VideoPreviewScreen)
  assert.equal(tree.props.href, "/server-management")
  assert.equal(h.requests.length, 0)
})

test("快速连点只打开一个预览，返回并重新聚焦后才能再次打开", () => {
  const h = harness("../src/features/video-preview/use-open-video-preview.ts")
  let open = h.render(h.api.useOpenVideoPreview); h.commit()
  open({ ...source, type: "video" })
  open({ ...source, type: "video" })
  assert.equal(h.pushes.length, 1)
  h.environment.focused = false
  open = h.render(h.api.useOpenVideoPreview); h.commit()
  open({ ...source, type: "video" })
  assert.equal(h.pushes.length, 1)
  h.environment.focused = true
  open = h.render(h.api.useOpenVideoPreview); h.commit()
  open({ ...source, type: "video" })
  assert.equal(h.pushes.length, 2)
})

test("普通会话与合并聊天记录均接入同一个视频预览入口，原图片入口保留", () => {
  for (const file of [
    "../src/features/conversation/conversation-screen.tsx",
    "../src/features/chat-records/chat-record-screen.tsx",
  ]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8")
    assert.match(code, /onVideoPress=\{openVideoPreview\}/)
    assert.match(code, /onImagePress=/)
  }
  const layout = readFileSync(new URL("../src/app/_layout.tsx", import.meta.url), "utf8")
  assert.match(layout, /name="video-preview"/)
})
