import assert from "node:assert/strict"
import test from "node:test"

import { createNicknameRequest, validateAvatarSource } from "@/domain/users/profile-edit"

const validSource = {
  fileName: "avatar.png",
  fileSize: 1024,
  height: 256,
  mimeType: "image/png",
  uri: "file:///avatar.png",
  width: 256,
}

test("头像源文件约束", () => {
  assert.equal(validateAvatarSource(validSource), null)
  assert.match(validateAvatarSource({ ...validSource, mimeType: "image/gif", fileName: "a.gif" }) ?? "", /PNG/)
  assert.match(validateAvatarSource({ ...validSource, fileSize: 5 * 1024 * 1024 + 1 }) ?? "", /5MiB/)
  assert.match(validateAvatarSource({ ...validSource, width: 63 }) ?? "", /64x64/)
  assert.match(validateAvatarSource({ ...validSource, height: 4097 }) ?? "", /4096x4096/)
})

test("头像选择器缺少可选类型元数据时仍可处理", () => {
  assert.equal(
    validateAvatarSource({
      fileSize: 1024,
      height: 256,
      width: 256,
    }),
    null
  )
})

test("昵称 PATCH 请求会去除首尾空白", () => {
  assert.deepEqual(createNicknameRequest("  新昵称  "), {
    body: JSON.stringify({ nickname: "新昵称" }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  })
})
