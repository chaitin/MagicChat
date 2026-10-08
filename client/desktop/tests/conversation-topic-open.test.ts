import assert from "node:assert/strict"
import test from "node:test"
import { topicOpenMode } from "../src/main/account/conversation-topic.ts"
import type { DesktopConversationTopic } from "../src/shared/account-data.ts"

const topic: DesktopConversationTopic = {
  archived: false,
  parentConversationId: "group-1",
  participating: false,
  sourceSender: { id: "user-1", name: "张三", type: "user" },
}

test("未加入且允许参与时自动加入话题", () => {
  assert.equal(topicOpenMode(topic, true), "join")
})

test("已加入话题不再重复加入", () => {
  assert.equal(topicOpenMode({ ...topic, participating: true }, true), "joined")
})

test("未加入的已关闭话题只读查看", () => {
  assert.equal(topicOpenMode({ ...topic, archived: true }, false), "view")
})

test("未加入且不能参与时拒绝打开", () => {
  assert.equal(topicOpenMode(topic, false), "denied")
})
