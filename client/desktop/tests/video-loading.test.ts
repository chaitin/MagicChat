import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

type Element = { type: string; props: Record<string, unknown>; children: unknown[] }
const text = readFileSync(
  new URL("../src/renderer/features/chat/message-bodies/media-body.tsx", import.meta.url),
  "utf8",
)
const ast = ts.createSourceFile(
  "media-body.tsx",
  text,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
const declaration = ast.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "VideoBody",
)!
const code = ts.transpileModule(declaration.getText(ast), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
  },
}).outputText

function render(status: string, cached = false) {
  const exports = {} as { VideoBody: (props: unknown) => Element }
  runInNewContext(code, {
    exports,
    React: {
      createElement: (type: string, props: Record<string, unknown>, ...children: unknown[]) => ({
        type,
        props: props ?? {},
        children,
      }),
    },
    useContext: () => ({ conversationName: "Room" }),
    MediaContext: {},
    useCachedMedia: () => ({
      status,
      cached: cached ? {} : undefined,
      downloadedBytes: 1,
      totalBytes: 2,
    }),
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
    HugeiconsIcon: "icon",
    PlayCircle02Icon: "play",
    Loading03Icon: "loader",
    MediaProgressOverlay: "progress",
    MediaCaption: "caption",
  })
  return exports.VideoBody({
    body: { type: "video", fileId: "file", name: "test.mp4" },
    targetId: "account",
    flush: false,
  })
}

function find(root: Element, type: string): Element[] {
  return [
    ...(root.type === type ? [root] : []),
    ...root.children.flatMap((child) =>
      child && typeof child === "object" && "type" in child ? find(child as Element, type) : [],
    ),
  ]
}

for (const status of ["downloading", "verifying"]) {
  test(`视频 ${status} 时只显示中央旋转loader，不显示下载进度条`, () => {
    const root = render(status)
    const icon = find(root, "icon")[0]
    assert.equal(icon.props.icon, "loader")
    assert.match(String(icon.props.className), /animate-spin/)
    assert.equal(find(root, "progress").length, 0)
    const button = find(root, "button")[0]
    assert.equal(button.props.disabled, true)
    assert.equal(button.props["aria-busy"], true)
  })
}

test("视频未下载、下载失败或已有缓存时显示播放图标，不旋转", () => {
  for (const [status, cached] of [
    ["idle", false],
    ["failed", false],
    ["cached", true],
  ] as const) {
    const root = render(status, cached)
    const icon = find(root, "icon")[0]
    assert.equal(icon.props.icon, "play")
    assert.doesNotMatch(String(icon.props.className), /animate-spin/)
    assert.equal(find(root, "button")[0].props.disabled, false)
  }
})
