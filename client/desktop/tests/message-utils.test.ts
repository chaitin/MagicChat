import assert from "node:assert/strict"
import test from "node:test"
import {
  formatDuration,
  formatFileSize,
  imageThumbnailFrame,
  progressPercentage,
  progressWidth,
} from "../src/renderer/features/chat/message-bodies/utils.ts"
import { normalizeDesktopMessageDetails } from "../src/main/account/message-normalizer.ts"

test("媒体进度限制在 0 到 100", () => {
  assert.equal(progressPercentage(50, 100), 50)
  assert.equal(progressPercentage(120, 100), 100)
  assert.equal(progressPercentage(-10, 100), 0)
  assert.equal(progressPercentage(10), undefined)
  assert.equal(progressWidth(10), "33%")
})

test("媒体尺寸和时长格式化", () => {
  assert.equal(formatFileSize(512), "512 B")
  assert.equal(formatFileSize(1536), "1.5 KB")
  assert.equal(formatDuration(61_000), "1:01")
})

test("图片缩略图保持比例并限制边界", () => {
  assert.deepEqual(imageThumbnailFrame(), { width: 256, height: 256 })
  assert.deepEqual(imageThumbnailFrame(640, 320), { width: 320, height: 160 })
  assert.deepEqual(imageThumbnailFrame(100, 400), { width: 160, height: 360 })
})

test("群聊邀请系统消息显示邀请人和成员", () => {
  const details = normalizeDesktopMessageDetails({
    body: {
      type: "system_event",
      event: "group_members_invited",
      inviter: { id: "user-1", display_name: "张三" },
      invitees: [
        { id: "user-2", display_name: "李四" },
        { id: "app-1", display_name: "日报助手" },
      ],
    },
  })

  assert.deepEqual(details.body, {
    type: "system_event",
    event: "group_members_invited",
    summary: "张三 邀请 李四,日报助手 加入群聊",
  })
})
