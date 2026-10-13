import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import DocumentAttachmentIcon from "@hugeicons/core-free-icons/dist/esm/DocumentAttachmentIcon"
import Download01Icon from "@hugeicons/core-free-icons/dist/esm/Download01Icon"
import Folder02Icon from "@hugeicons/core-free-icons/dist/esm/Folder02Icon"
import Loading03Icon from "@hugeicons/core-free-icons/dist/esm/Loading03Icon"

const root = new URL("../", import.meta.url)
const source = (path: string) => readFile(new URL(path, root), "utf8")

async function fileBodySource() {
  const body = await source("src/features/conversation/messages/message-body.tsx")
  return body.split('if (body.type === "file")')[1].split('if (body.type === "image")')[0]
}

test("文件气泡复用 Desktop 的四款图标，并只加载单个图标模块", async () => {
  const [icons, desktop, pkg] = await Promise.all([
    source("src/features/conversation/messages/message-content-icon.tsx"),
    readFile(new URL("../../desktop/src/renderer/features/chat/message-bodies/media-body.tsx", import.meta.url), "utf8"),
    source("package.json"),
  ])
  assert.equal(JSON.parse(pkg).dependencies["@hugeicons/core-free-icons"], "4.3.2")
  for (const name of ["DocumentAttachmentIcon", "Download01Icon", "Folder02Icon", "Loading03Icon"]) {
    assert.ok(icons.includes(`from "@hugeicons/core-free-icons/dist/esm/${name}"`))
    assert.ok(desktop.includes(name))
  }
  for (const icon of [DocumentAttachmentIcon, Download01Icon, Folder02Icon, Loading03Icon]) {
    assert.ok(icon.length > 0)
    assert.ok(icon.every(([tag, attributes]) => tag === "path" && typeof attributes.d === "string"))
  }
  assert.equal(DocumentAttachmentIcon.length, 4)
  assert.equal(Download01Icon.length, 2)
  assert.equal(Folder02Icon.length, 2)
  assert.equal(Loading03Icon.length, 8)
  assert.match(icons, /strokeWidth = size === 28 \? 1\.5 : 2/)
})

test("文件布局为左图标、中间上名称下大小、右按钮，保持 Mobile 宽度", async () => {
  const body = await fileBodySource()
  assert.match(body, /alignItems: "center", flexDirection: "row", gap: 12, width: "100%"/)
  assert.match(body, /color=\{colors\.textPrimary\} kind="attachment" size=\{28\}/)
  assert.match(body, /<View style=\{\{ flex: 1, minWidth: 0 \}\}>[\s\S]*?numberOfLines=\{1\}[\s\S]*?color: colors\.textPrimary[\s\S]*?\{body\.name\}[\s\S]*?color: colors\.textSecondary[\s\S]*?formatFileSize\(body\.sizeBytes\)/)
  assert.match(body, /kind=\{isLoading \? "loading" : isDownloaded \? "open" : "download"\}/)
  const action = await source("src/features/conversation/messages/message-action-button.tsx")
  assert.match(action, /kind=\{kind\} size=\{16\}/)
  assert.doesNotMatch(body, /文件 \{formatFileSize|icon=\{FileText\}/)
  const bubble = await source("src/features/conversation/messages/message-bubble.tsx")
  assert.match(bubble, /message\.body\.type === "file"/)
  assert.match(bubble, /usesStructuredBubbleWidth\s*\? "66%"/)
})

test("下载中显示真实加载状态，图标按 Desktop 的一秒线性旋转并清理", async () => {
  const body = await fileBodySource()
  assert.match(body, /const isLoading = state\?\.status === "loading"/)
  assert.match(body, /isLoading \? "下载中" : formatFileSize\(body\.sizeBytes\)/)
  assert.match(body, /disabled=\{isLoading\}/)
  assert.match(body, /正在下载文件/)
  const icon = await source("src/features/conversation/messages/message-content-icon.tsx")
  assert.match(icon, /Animated\.loop\(Animated\.timing/)
  assert.match(icon, /duration: 1_000/)
  assert.match(icon, /easing: Easing\.linear/)
  assert.match(icon, /useNativeDriver: true/)
  assert.match(icon, /return \(\) => animation\.stop\(\)/)
  assert.match(icon, /outputRange: \["0deg", "360deg"\]/)
})

test("缓存文件显示打开图标，未缓存显示下载，下载中禁用并旋转", async () => {
  const body = await fileBodySource()
  assert.match(body, /const isDownloaded = state\?\.status === "ready" && Boolean\(state\.resource\)/)
  assert.match(body, /kind=\{isLoading \? "loading" : isDownloaded \? "open" : "download"\}/)
  assert.match(body, /isDownloaded \? `打开文件 \$\{body\.name\}` : `下载并打开文件 \$\{body\.name\}`/)
  const action = await source("src/features/conversation/messages/message-action-button.tsx")
  assert.match(action, /accessibilityState=\{\{ disabled, busy: kind === "loading" \}\}/)
})

test("文件按钮按下仅用正文色5%圆角覆盖层，不改变其他按钮背景", async () => {
  const file = await fileBodySource()
  assert.match(file, /<MessageActionButton/)
  const body = await source("src/features/conversation/messages/message-action-button.tsx")
  assert.match(body, /\{\(\{ pressed \}\) =>/)
  assert.match(body, /pressed \? \([\s\S]*?pointerEvents="none"[\s\S]*?borderRadius: 8, backgroundColor: colors\.textPrimary, opacity: 0\.05/)
  assert.match(body, /height: 36, width: 36/)
  assert.doesNotMatch(body, /NativeIconButton|background[15]|opacity: 0\.05[\s\S]*?<View/)
})

test("文件按钮保留系统打开入口与长按防误触，不改为打开文件夹", async () => {
  const body = await fileBodySource()
  assert.match(body, /if \(didLongPressResourceRef\.current\) \{\s*didLongPressResourceRef\.current = false\s*return\s*\}\s*onResourcePress\(body\.fileId\)/)
  assert.equal(body.match(/didLongPressResourceRef\.current = true/g)?.length, 2)
  assert.match(body, /onPressIn=\{\(\) => \{\s*didLongPressResourceRef\.current = false/)
  assert.match(body, /`打开文件 \$\{body\.name\}`/)
  assert.doesNotMatch(body, /revealCached/)
})
