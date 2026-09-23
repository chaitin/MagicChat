import assert from "node:assert/strict"
import test from "node:test"
import { formatMentionText } from "../src/renderer/lib/message-mentions.ts"

const userId = "123e4567-e89b-12d3-a456-426614174000"
const appId = "123e4567-e89b-12d3-a456-426614174001"

test("摘要统一将 mention 模板转换为显示名称", () => {
  assert.equal(
    formatMentionText(`请 {{@${userId}}} 联系 {(@app/${appId})}，并通知 {{@all}}`, (target) => {
      if (target.id === userId) return "Alice"
      if (target.id === appId) return "项目助手"
      return undefined
    }),
    "请 @Alice 联系 @项目助手，并通知 @所有人",
  )
})

test("无法解析的 mention 使用统一兜底名称", () => {
  assert.equal(
    formatMentionText(`回复 {{@${userId}}}`, () => undefined),
    "回复 @用户",
  )
})
