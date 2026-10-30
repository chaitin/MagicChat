import assert from "node:assert/strict"
import test from "node:test"
import { createMessageSyncBudget, runAutomaticMessageJobs, selectAutomaticConversations } from "../../shared/message-sync-budget.ts"

test("三端共享的消息预算合计不超过100，最新页携带实际请求上限", () => {
  const budget = createMessageSyncBudget()
  assert.deepEqual(budget.decide({ lastMessageSeq: 3 }, undefined), { type: "latest", limit: 3 })
  assert.deepEqual(budget.decide({ lastMessageSeq: 100 }, undefined), { type: "latest", limit: 20 })
  assert.deepEqual(budget.decide({ lastMessageSeq: 87 }, { httpSyncedThroughSeq: 10 }), { type: "after", afterSeq: 10, targetSeq: 87 })
  assert.deepEqual(budget.decide({ lastMessageSeq: 1 }, undefined), { type: "skip" })
  assert.deepEqual(createMessageSyncBudget().decide({ lastMessageSeq: 101 }, undefined), { type: "skip" })
  assert.deepEqual(createMessageSyncBudget().decide({ lastMessageSeq: 201 }, { httpSyncedThroughSeq: 100 }), { type: "skip" })
})

test("自动同步至多选择30个会话，当前优先，其次未读且不改写原列表", () => {
  const conversations = Array.from({ length: 40 }, (_, i) => ({ id: String(i), unreadCount: i === 35 ? 1 : 0 }))
  const selected = selectAutomaticConversations(conversations, "39")
  assert.equal(selected.length, 30)
  assert.deepEqual(selected.slice(0, 3).map(({ id }) => id), ["39", "35", "0"])
  assert.equal(conversations[0]!.id, "0")
})

test("后台消息任务真实等待网络请求，最大并发为3", async () => {
  let release!: () => void
  let started!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const firstBatch = new Promise<void>((resolve) => { started = resolve })
  let active = 0
  let peak = 0
  const calls: number[] = []
  const work = runAutomaticMessageJobs(Array.from({ length: 8 }, (_, i) => i), async (id) => {
    calls.push(id)
    active += 1
    peak = Math.max(peak, active)
    if (calls.length === 3) started()
    await blocked
    active -= 1
  })
  await firstBatch
  assert.equal(calls.length, 3)
  release()
  await work
  assert.equal(calls.length, 8)
  assert.equal(peak, 3)
})

test("单个会话失败仍完成其它任务，整轮结束后报告失败", async () => {
  const calls: number[] = []
  await assert.rejects(runAutomaticMessageJobs([0, 1, 2, 3, 4], async (id) => {
    calls.push(id)
    if (id === 0) throw new Error("offline")
  }), /offline/)
  assert.deepEqual(calls, [0, 1, 2, 3, 4])
})
