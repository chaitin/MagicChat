import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const html = await readFile(path.join(root, "out/renderer/index.html"), "utf8")
const captureHtml = await readFile(path.join(root, "out/renderer/capture.html"), "utf8")
const main = await readFile(path.join(root, "out/main/index.js"), "utf8")
const preload = await readFile(path.join(root, "out/preload/index.cjs"), "utf8")
const mainOutput = path.join(root, "out/main")
const messageCacheWorkerNames = (await readdir(mainOutput)).filter((name) =>
  /^message-cache-worker-.+\.js$/.test(name),
)
assert(messageCacheWorkerNames.length > 0, "消息缓存 Worker 产物缺失")
const messageCacheWorkerName = messageCacheWorkerNames.find((name) => main.includes(name))
assert(messageCacheWorkerName, "Main 未引用消息缓存 Worker 产物")
const messageCacheWorker = await readFile(path.join(mainOutput, messageCacheWorkerName), "utf8")
const rendererAssets = path.join(root, "out/renderer/assets")
const rendererAssetNames = await readdir(rendererAssets)
const rendererScriptNames = rendererAssetNames.filter((name) => /\.(?:c?js|mjs)$/.test(name))
const rendererScripts = await Promise.all(
  rendererScriptNames.map((name) => readFile(path.join(rendererAssets, name), "utf8")),
)
const documentChunkNames = rendererAssetNames.filter((name) =>
  /^(?:document-page|document-route)-.+\.js$/.test(name),
)
assert(documentChunkNames.length === 1, "文档路由 chunk 缺失或重复")
const documentChunkName = documentChunkNames[0]
const documentChunk = await readFile(path.join(rendererAssets, documentChunkName), "utf8")
const indexScriptName = html.match(/src="\.\/assets\/([^"]+\.js)"/)?.[1]
assert(indexScriptName, "Renderer 主入口脚本缺失")
const indexScript = await readFile(path.join(rendererAssets, indexScriptName), "utf8")
assert(
  indexScript.includes("createJavaScriptRegexEngine"),
  "Renderer 代码高亮未使用 JavaScript 引擎",
)
assert(
  !rendererScripts.some((script) => script.includes("onig.wasm")),
  "Renderer 仍包含 Oniguruma Wasm",
)
const rendererCssNames = [...html.matchAll(/href="\.\/assets\/([^"]+\.css)"/g)].map(
  (match) => match[1],
)
assert(rendererCssNames.length > 0, "Renderer 缺少主样式产物")
const rendererCss = (
  await Promise.all(
    rendererCssNames.map((name) => readFile(path.join(rendererAssets, name), "utf8")),
  )
).join("\n")

assert(html.includes("Content-Security-Policy"), "Renderer 缺少 CSP")
assert(
  html.includes("connect-src 'self' magicchat-media: magicchat-capture:"),
  "Renderer CSP connect-src 被放宽",
)
assert(!html.includes(documentChunkName), "Renderer HTML 静态加载了文档路由 chunk")
assert(indexScript.includes(documentChunkName), "Renderer 主入口未按路由引用文档 chunk")
assert(documentChunk.includes("desktop://document-collaboration"), "文档 chunk 缺少协作适配器")
for (const forbidden of ["client-web/src", "client-web/public", 'require("electron")']) {
  assert(!documentChunk.includes(forbidden), `文档 chunk 包含禁止内容 ${forbidden}`)
}
assert(captureHtml.includes("Content-Security-Policy"), "截图 Renderer 缺少 CSP")
assert(captureHtml.includes("magicchat-capture:"), "截图 Renderer CSP 未允许截图资源协议")
assert(!html.includes("http://localhost"), "生产 Renderer 包含开发服务器地址")
assert(!captureHtml.includes("http://localhost"), "生产截图 Renderer 包含开发服务器地址")
assert(main.includes("ELECTRON_RENDERER_URL"), "Main 缺少显式开发分支")
assert(
  main.includes("!app.isPackaged") || /![A-Za-z0-9_$]*electron\.app\.isPackaged/.test(main),
  "开发地址没有受 packaged 条件保护",
)
assert(
  !/import\s*\{[^}]*autoUpdater[^}]*\}\s*from\s*["']electron-updater["']/.test(main),
  "Main 使用了不兼容 CommonJS 的 electron-updater 命名导入",
)
assert(
  /import\s+\w+\s+from\s+["']electron-updater["']/.test(main),
  "Main 缺少 electron-updater 默认导入",
)
assert((await stat(path.join(root, "out/preload/index.cjs"))).size > 0, "Preload 产物为空")
assert(messageCacheWorker.length > 0, "消息缓存 Worker 产物为空")
assert(messageCacheWorker.includes("node:sqlite"), "消息缓存 Worker 未包含 node:sqlite 入口")
assert(preload.includes('require("electron")'), "沙箱 Preload 未使用 CommonJS 加载 Electron")
assert(!/^import\s/m.test(preload), "沙箱 Preload 包含不兼容的 ESM 导入")
for (const assetPath of captureHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)) {
  const relativePath = assetPath[1].replace(/^\.\//, "").replace(/^\//, "")
  assert(
    (await stat(path.join(root, "out/renderer", relativePath))).size > 0,
    "截图 Renderer 资产为空",
  )
}
assert(/(?:src|href)="[^"]+\/assets\/[^"]+"/.test(captureHtml), "截图 Renderer 入口资产缺失")
for (const className of [".bg-background", ".flex", ".min-h-svh", ".text-muted-foreground"]) {
  assert(rendererCss.includes(className), `Renderer 缺少共享界面样式 ${className}`)
}

console.log(
  JSON.stringify({
    arch: process.arch,
    documentChunk: {
      bytes: (await stat(path.join(rendererAssets, documentChunkName))).size,
      name: documentChunkName,
    },
    platform: process.platform,
    rendererCss: rendererCssNames,
  }),
)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
