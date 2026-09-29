import assert from "node:assert/strict"
import test from "node:test"
import {
  detectImageContentType,
  isSelectionExpired,
  isValidAvatarUpload,
  mediaContentType,
  selectionLifetimeMs,
} from "../src/main/message-files/selection-policy.ts"

test("选择 token 在十分钟后失效", () => {
  const selectedAt = 1_000
  assert.equal(isSelectionExpired(selectedAt, selectedAt + selectionLifetimeMs), false)
  assert.equal(isSelectionExpired(selectedAt, selectedAt + selectionLifetimeMs + 1), true)
})

test("媒体扩展名只映射允许的格式", () => {
  assert.equal(mediaContentType("image", ".jpeg"), "image/jpeg")
  assert.equal(mediaContentType("image", ".gif"), "")
  assert.equal(mediaContentType("video", ".mp4"), "video/mp4")
  assert.equal(mediaContentType("video", ".mov"), "")
})

test("头像上传校验字节大小与 WebP 文件头", () => {
  const webp = Uint8Array.from(Buffer.from("RIFF0000WEBP", "ascii"))
  assert.equal(isValidAvatarUpload(webp.buffer), true)
  assert.equal(isValidAvatarUpload(webp), false)
  assert.equal(isValidAvatarUpload(new ArrayBuffer(0)), false)
  assert.equal(isValidAvatarUpload(Uint8Array.from([0xff, 0xd8, 0xff]).buffer), false)
  const oversized = new Uint8Array(1024 * 1024 + 1)
  oversized.set(webp)
  assert.equal(isValidAvatarUpload(oversized.buffer), false)
})

test("图片签名检测不依赖文件扩展名", () => {
  assert.equal(
    detectImageContentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  )
  assert.equal(
    detectImageContentType(Uint8Array.from(Buffer.from("RIFF0000WEBP", "ascii"))),
    "image/webp",
  )
  assert.equal(detectImageContentType(Uint8Array.from(Buffer.from("not-an-image"))), undefined)
})
