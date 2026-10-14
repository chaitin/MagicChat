import assert from "node:assert/strict"
import test from "node:test"

import { normalizeClientMessage } from "@/data/messages/message-normalizer"
import { formatClientMessageBodySummary } from "@/domain/messages/message-presenter"
import { shouldShowMessageNotification } from "@/notifications/message-notification-policy"

const actor = { display_name: "张三", id: "owner" }
const target = { display_name: "李四", id: "member" }
const fixtures = [
  [{ event: "friendship_created" }, "你们已成为好友，现在可以开始聊天了"],
  [{ event: "group_members_invited", inviter: actor, invitees: [target] }, "张三 邀请 李四 加入群聊"],
  [{ event: "group_avatar_updated", actor }, "张三 修改了群头像"],
  [{ event: "group_visibility_changed", actor, visibility: "public" }, "张三 将当前群设置为公开群"],
  [{ event: "group_visibility_changed", actor, visibility: "private" }, "张三 将当前群设为私有群"],
  [{ event: "group_member_joined", actor }, "张三 加入群聊"],
  [{ event: "group_member_left", actor }, "张三 已退出群聊"],
  [{ event: "group_member_removed", actor, target }, "张三 已将 李四 移出群聊"],
  [{ event: "group_member_role_updated", actor, target, role: "admin" }, "张三 将 李四 设为管理员"],
  [{ event: "group_member_role_updated", actor, target, role: "member" }, "张三 取消了 李四 的管理员"],
  [{ event: "group_name_updated", actor, name: "产品群" }, "张三 修改群聊名称为 产品群"],
  [{ event: "group_announcement_updated", actor, announcement: "周五团建" }, "张三 更新了群公告"],
  [{ event: "group_announcement_updated", actor, announcement: "" }, "张三 清空了群公告"],
  [{ event: "topic_closed", actor }, "张三 已将话题关闭"],
  [{ event: "message_revoked", actor }, "张三 撤回了一条消息"],
] as const

for (const [body, summary] of fixtures) {
  test(`系统消息正确解析并显示：${summary}`, () => {
    const message = normalizeEvent(body)
    assert.equal(message.body.type, "system_event")
    assert.equal(formatClientMessageBodySummary(message.body, () => undefined), summary)
  })
}

test("管理员系统消息支持应用作为操作者和目标", () => {
  const message = normalizeEvent({
    event: "group_member_role_updated", role: "admin",
    actor: { id: "app-1", display_name: "群管助手", type: "app" },
    target: { id: "app-2", display_name: "日报助手", type: "app" },
  })
  assert.equal(formatClientMessageBodySummary(message.body, () => undefined), "群管助手 将 日报助手 设为管理员")
})

test("无效角色、缺失成员或公告字段仍降级为不支持的消息", () => {
  for (const body of [
    { event: "group_member_role_updated", actor, target, role: "owner" },
    { event: "group_member_role_updated", actor, target },
    { event: "group_member_role_updated", actor, role: "admin" },
    { event: "group_member_role_updated", target, role: "admin" },
    { event: "group_member_role_updated", actor, target: { id: "member" }, role: "admin" },
    { event: "group_announcement_updated", actor },
    { event: "group_announcement_updated", actor, announcement: 123 },
    { event: "group_announcement_updated", announcement: "公告" },
    { event: "unknown_event", actor },
  ]) {
    assert.deepEqual(normalizeEvent(body).body, { type: "unsupported" })
  }
})

test("好友消息不要求actor，新增系统消息继续遵循原通知策略", () => {
  assert.equal(shouldShowMessageNotification({ message: normalizeEvent({ event: "friendship_created" }), recipientUserId: "owner" }), true)
  const message = normalizeEvent({ event: "group_member_role_updated", actor, target, role: "admin" })
  assert.equal(shouldShowMessageNotification({ message, recipientUserId: "owner" }), false)
  assert.equal(shouldShowMessageNotification({ message, recipientUserId: "member" }), true)
  assert.equal(shouldShowMessageNotification({ message, recipientUserId: "member", notificationMuted: true }), false)
})

function normalizeEvent(body: Record<string, unknown>) {
  return normalizeClientMessage({
    body: { ...body, type: "system_event" },
    conversation_id: "group-1", created_at: "2026-10-14T00:00:00Z", id: "system-1",
    sender: { type: "system" }, seq: 1,
  })
}
