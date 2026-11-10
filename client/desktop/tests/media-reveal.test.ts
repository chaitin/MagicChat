import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

test("附件定位使用完整文件路径选中文件，兼容缓存及本地发送文件", async () => {
  const source = ts.createSourceFile(
    "ipc.ts",
    readFileSync(new URL("../src/main/ipc/register-media-ipc.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  )
  const fn = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "registerMediaIpc",
  )!
  const code = ts.transpileModule(fn.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
  const shown: string[] = []
  const lookups: unknown[] = []
  const exports = {} as any
  runInNewContext(code, {
    exports,
    MEDIA_CHANNELS: { revealCached: "reveal" },
    AuthFailure: Error,
    shell: { showItemInFolder: (path: string) => shown.push(path) },
  })
  exports.registerMediaIpc({
    handle: (channel: string, callback: any) => handlers.set(channel, callback),
    auth: {
      getCachedMediaResource: async (...args: unknown[]) => {
        lookups.push(args)
        return { filePath: "/cache/attachment/report.pdf" }
      },
      getOutgoingMedia: async (...args: unknown[]) => {
        lookups.push(args)
        return { filePath: "/documents/source.docx" }
      },
    },
    mediaPreview: {},
  })
  const reveal = handlers.get("reveal")!
  await reveal({ targetId: "account", cacheKey: "cached-key" })
  await reveal({ targetId: "account", cacheKey: "outgoing:local-id" })
  assert.deepEqual(shown, ["/cache/attachment/report.pdf", "/documents/source.docx"])
  assert.deepEqual(lookups, [
    ["account", "cached-key"],
    ["account", "local-id"],
  ])
  await assert.rejects(reveal(null))
  assert.equal(shown.length, 2)
})
