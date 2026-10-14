import { describe, expect, it } from "vitest"

import {
  formatClientMessageBodySummary,
  isClientMessageInitiatedByUser,
  type MessageBodyResponse,
} from "@/lib/client-data-api"
import {
  normalizeClientMessageBody,
  normalizeMessage,
} from "./message-normalizers"

const actor = { display_name: "张三", id: "owner" }
const target = { display_name: "李四", id: "member" }
const fixtures = [
  [{ event: "friendship_created" }, "你们已成为好友，现在可以开始聊天了"],
  [
    { event: "group_members_invited", inviter: actor, invitees: [target] },
    "张三 邀请 李四 加入群聊",
  ],
  [{ event: "group_avatar_updated", actor }, "张三 修改了群头像"],
  [
    { event: "group_visibility_changed", actor, visibility: "public" },
    "张三 将当前群设置为公开群",
  ],
  [
    { event: "group_visibility_changed", actor, visibility: "private" },
    "张三 将当前群设为私有群",
  ],
  [{ event: "group_member_joined", actor }, "张三 加入群聊"],
  [{ event: "group_member_left", actor }, "张三 已退出群聊"],
  [{ event: "group_member_removed", actor, target }, "张三 已将 李四 移出群聊"],
  [
    { event: "group_member_role_updated", actor, target, role: "admin" },
    "张三 将 李四 设为管理员",
  ],
  [
    { event: "group_member_role_updated", actor, target, role: "member" },
    "张三 取消了 李四 的管理员",
  ],
  [
    { event: "group_name_updated", actor, name: "产品群" },
    "张三 修改群聊名称为 产品群",
  ],
  [
    { event: "group_announcement_updated", actor, announcement: "周五团建" },
    "张三 更新了群公告",
  ],
  [
    { event: "group_announcement_updated", actor, announcement: "" },
    "张三 清空了群公告",
  ],
  [{ event: "topic_closed", actor }, "张三 已将话题关闭"],
  [{ event: "message_revoked", actor }, "张三 撤回了一条消息"],
] as const

describe("系统消息兼容", () => {
  it.each(fixtures)("正确解析 %j 并显示具体文案", (body, summary) => {
    const message = normalizeEvent(body)
    expect(message.body.type).toBe("system_event")
    expect(formatClientMessageBodySummary(message.body)).toBe(summary)
  })

  it("支持应用作为操作者和目标", () => {
    const message = normalizeEvent({
      event: "group_member_role_updated",
      role: "admin",
      actor: { id: "app-1", display_name: "群管助手", type: "app" },
      target: { id: "app-2", display_name: "日报助手", type: "app" },
    })
    expect(formatClientMessageBodySummary(message.body)).toBe(
      "群管助手 将 日报助手 设为管理员"
    )
  })

  it.each([
    { event: "group_member_role_updated", actor, target, role: "owner" },
    { event: "group_member_role_updated", actor, target },
    { event: "group_member_role_updated", actor, role: "admin" },
    { event: "group_member_role_updated", target, role: "admin" },
    {
      event: "group_member_role_updated",
      actor,
      target: { id: "member" },
      role: "admin",
    },
    { event: "unknown_event", actor },
  ])("无效事件或管理员字段不生成错误文案：%j", (body) => {
    expect(normalizeEvent(body).body).toEqual({ type: "unsupported" })
  })

  it("角色变更通知识别操作者，好友消息不依赖actor", () => {
    const message = normalizeEvent({
      event: "group_member_role_updated",
      actor,
      target,
      role: "admin",
    })
    expect(isClientMessageInitiatedByUser(message, "owner")).toBe(true)
    expect(isClientMessageInitiatedByUser(message, "member")).toBe(false)
    expect(
      isClientMessageInitiatedByUser(
        normalizeEvent({ event: "friendship_created" }),
        "owner"
      )
    ).toBe(false)
  })

  it("规范化管理员字段供系统消息展示使用", () => {
    const body = normalizeClientMessageBody({
      type: "system_event",
      event: "group_member_role_updated",
      actor,
      target,
      role: "admin",
    })
    expect(body).toEqual({
      type: "system_event",
      event: "group_member_role_updated",
      role: "admin",
      actor: { displayName: "张三", id: "owner" },
      target: { displayName: "李四", id: "member" },
    })
  })
})

function normalizeEvent(body: Record<string, unknown>) {
  return normalizeMessage({
    body: { ...body, type: "system_event" } as MessageBodyResponse,
    conversation_id: "group-1",
    created_at: "2026-10-14T00:00:00Z",
    id: "system-1",
    sender: { type: "system" },
    seq: 1,
  })
}
