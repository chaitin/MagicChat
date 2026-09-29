import assert from "node:assert/strict"
import test from "node:test"
import {
  formatDuration,
  formatFileSize,
  imageThumbnailFrame,
  progressPercentage,
  progressWidth,
} from "../src/renderer/features/chat/message-bodies/utils.ts"
import {
  normalizeDesktopMessageDetails,
  summarizeDesktopMessageBody,
} from "../src/main/account/message-normalizer.ts"

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

test("合并聊天记录摘要展示条数和首条消息", () => {
  assert.equal(
    summarizeDesktopMessageBody({
      type: "forward_bundle",
      itemCount: 2,
      items: [
        {
          senderName: "Alice",
          senderType: "user",
          sentAt: "2026-07-13T10:00:00Z",
          summary: "第一条消息",
          body: { type: "text", content: "第一条消息" },
        },
      ],
    }),
    "[聊天记录] 2 条 - 第一条消息",
  )
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

test("媒体与文件消息摘要带类型前缀", () => {
  assert.equal(
    summarizeDesktopMessageBody({
      type: "image",
      fileId: "file-1",
      caption: "随手拍",
      captionType: "text",
      width: 640,
      height: 320,
    }),
    "[图片] 随手拍",
  )
  assert.equal(summarizeDesktopMessageBody({ type: "image", fileId: "file-1" }), "[图片]")
  assert.equal(
    summarizeDesktopMessageBody({
      type: "video",
      fileId: "file-2",
      name: "clip.mp4",
      sizeBytes: 1024,
      contentType: "video/mp4",
    }),
    "[视频]",
  )
  assert.equal(
    summarizeDesktopMessageBody({
      type: "file",
      fileId: "file-3",
      name: "报告.pdf",
      sizeBytes: 2048,
    }),
    "[文件] 报告.pdf",
  )
  assert.equal(
    summarizeDesktopMessageBody({
      type: "voice",
      fileId: "file-4",
      sizeBytes: 512,
      durationMS: 3000,
      contentType: "audio/ogg",
      transcript: "你好",
    }),
    "[语音] 你好",
  )
})

test("链接、卡片、图表、选择消息摘要带类型前缀", () => {
  assert.equal(
    summarizeDesktopMessageBody({
      type: "link",
      title: "示例站点",
      url: "https://example.com",
    }),
    "[链接] 示例站点",
  )
  assert.equal(
    summarizeDesktopMessageBody({
      type: "card",
      title: "周报",
      description: "本周进展",
      url: "https://example.com/report",
    }),
    "[卡片] 周报",
  )
  assert.equal(
    summarizeDesktopMessageBody({
      type: "chart",
      chartType: "bar",
      title: "访问量",
      description: "近七日",
      data: [],
    }),
    "[图表] 访问量",
  )
  assert.equal(
    summarizeDesktopMessageBody({
      type: "choice",
      content: "选一个",
      contentType: "text",
      selection: "single",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    }),
    "[选择] 选一个",
  )
})

test("Markdown 摘要去掉标记语法", () => {
  assert.equal(
    summarizeDesktopMessageBody({
      type: "markdown",
      content: "# 标题\n\n**加粗** 和 `代码`\n\n- 条目\n\n[链接](https://example.com)",
    }),
    "标题\n加粗 和 代码\n条目\n链接",
  )
})

test("群系统消息摘要与 web 口径一致", () => {
  const summaryOf = (body: Record<string, unknown>) => {
    const details = normalizeDesktopMessageDetails({ body })
    return details.body.type === "system_event" ? details.body.summary : ""
  }

  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_member_joined",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 加入群聊",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_member_left",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 已退出群聊",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_member_removed",
      actor: { id: "user-1", display_name: "张三" },
      target: { id: "user-2", display_name: "李四" },
    }),
    "张三 已将 李四 移出群聊",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_name_updated",
      actor: { id: "user-1", display_name: "张三" },
      name: "产品群",
    }),
    "张三 修改群聊名称为 产品群",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_avatar_updated",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 修改了群头像",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_visibility_changed",
      visibility: "public",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 将当前群设置为公开群",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_visibility_changed",
      visibility: "private",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 将当前群设为私有群",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_announcement_updated",
      actor: { id: "user-1", display_name: "张三" },
      announcement: "本周五团建",
    }),
    "张三 更新了群公告",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "group_announcement_updated",
      actor: { id: "user-1", display_name: "张三" },
      announcement: "",
    }),
    "张三 清空了群公告",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "topic_closed",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 已将话题关闭",
  )
  assert.equal(
    summaryOf({
      type: "system_event",
      event: "message_revoked",
      actor: { id: "user-1", display_name: "张三" },
    }),
    "张三 撤回了一条消息",
  )
})
