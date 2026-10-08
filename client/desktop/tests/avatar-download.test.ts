import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AVATAR_ACCEPT,
  AVATAR_CONTENT_TYPES,
  avatarExtensionFor,
  detectAvatarContentType,
} from "../src/main/account/avatar-content-type.ts"

const avif = Buffer.from("000000186674797061766966000000006d69663100000000", "hex")

test("头像服务误报 JPEG 时仍按 AVIF 文件头确定实际类型", () => {
  assert.ok(AVATAR_CONTENT_TYPES.has("image/jpeg"))
  assert.equal(detectAvatarContentType(avif), "image/avif")
  assert.equal(avatarExtensionFor("image/avif"), "avif")
})

test("正确标注 AVIF 的头像也允许下载和缓存", () => {
  assert.ok(AVATAR_CONTENT_TYPES.has("image/avif"))
  assert.match(AVATAR_ACCEPT, /image\/avif/)
})

test("无效图片不能误判为 AVIF，现有图片类型不受影响", () => {
  assert.equal(detectAvatarContentType(Buffer.from("not an image")), undefined)
  assert.equal(detectAvatarContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg")
  assert.equal(avatarExtensionFor("image/jpeg"), "jpg")
})
