import assert from "node:assert/strict"
import test from "node:test"
import { prepareAppAvatar } from "../src/renderer/lib/app-avatar-processing.ts"

test("应用头像居中裁切并暂存 WebP，拒绝不合规尺寸及编码结果", async () => {
  const keys = ["Image", "document", "window"] as const
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  let width = 800
  let height = 400
  let outputType = "image/webp"
  let outputSize = 10
  const released: string[] = []
  let drawArgs: unknown[] = []
  let imported: File | undefined
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (...args: unknown[]) => {
        drawArgs = args.slice(1)
      },
    }),
    toBlob: (callback: (blob: Blob) => void, type: string, quality: number) => {
      assert.equal(type, "image/webp")
      assert.equal(quality, 0.9)
      callback(new Blob([new Uint8Array(outputSize)], { type: outputType }))
    },
  }
  Object.assign(globalThis, {
    Image: class {
      naturalWidth = width
      naturalHeight = height
      onload?: () => void
      set src(_value: string) {
        this.onload?.()
      }
    },
    document: { createElement: () => canvas },
    window: {
      desktop: {
        accountData: {
          releaseMessageFile: async ({ token }: { token: string }) => {
            released.push(token)
          },
          importMessageFile: async ({ file }: { file: File }) => {
            imported = file
            return { ok: true, data: { token: "prepared", resourceUrl: "prepared-url" } }
          },
        },
      },
    },
  })
  const source = {
    token: "source",
    name: "photo.jpg",
    sizeBytes: 100,
    contentType: "image/jpeg" as const,
    resourceUrl: "source-url",
  }
  try {
    const result = await prepareAppAvatar("account", source)
    assert.deepEqual(drawArgs, [200, 0, 400, 400, 0, 0, 256, 256])
    assert.equal(canvas.width, 256)
    assert.equal(canvas.height, 256)
    assert.equal(imported?.name, "photo.webp")
    assert.equal(imported?.type, "image/webp")
    assert.equal(result.token, "prepared")
    width = 32
    await assert.rejects(prepareAppAvatar("account", source), /64x64/)
    width = 800
    height = 4097
    await assert.rejects(prepareAppAvatar("account", source), /4096x4096/)
    height = 400
    outputType = "image/png"
    await assert.rejects(prepareAppAvatar("account", source), /WebP/)
    outputType = "image/webp"
    outputSize = 1024 * 1024 + 1
    await assert.rejects(prepareAppAvatar("account", source), /1MiB/)
    assert.equal(released.length, 5)
  } finally {
    keys.forEach((key, index) => {
      const descriptor = originals[index]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})
