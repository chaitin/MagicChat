import assert from "node:assert/strict"
import test from "node:test"

import type { ClientConversation } from "@/core/models"
import { catchUpMessagesTo, createMessageSyncBudget } from "@/features/bootstrap/message-sync-budget"

const target = { id: "server", url: "https://example.test", userId: "user" }
const conversation = (seq: number, id = "a") => ({ id, lastMessageSeq: seq }) as ClientConversation

test("sync budget skips unchanged, enforces 100 per conversation and in total", () => {
  const budget = createMessageSyncBudget()
  assert.deepEqual(budget.decide(conversation(100), { httpSyncedThroughSeq: 100 }), { type: "skip" })
  assert.deepEqual(budget.decide(conversation(120), { httpSyncedThroughSeq: 100 }), { type: "after", afterSeq: 100, targetSeq: 120 })
  assert.deepEqual(budget.decide(conversation(200), { httpSyncedThroughSeq: 100 }), { type: "skip" })
  assert.deepEqual(budget.decide(conversation(180, "b"), { httpSyncedThroughSeq: 100 }), { type: "after", afterSeq: 100, targetSeq: 180 })
  assert.deepEqual(budget.decide(conversation(1, "c"), undefined), { type: "skip" })
  assert.deepEqual(createMessageSyncBudget().decide(conversation(200), { httpSyncedThroughSeq: 100 }), { type: "after", afterSeq: 100, targetSeq: 200 })
  assert.deepEqual(createMessageSyncBudget().decide(conversation(201), { httpSyncedThroughSeq: 100 }), { type: "skip" })
  assert.deepEqual(createMessageSyncBudget().decide(conversation(101), undefined), { type: "skip" })
  assert.deepEqual(createMessageSyncBudget().decide(conversation(100), { httpSyncedThroughSeq: 0 }), { type: "latest" })
})

test("catch-up pages until snapshot boundary without crossing the budget", async () => {
  const calls: number[] = []
  await catchUpMessagesTo(target, "a", 4, 45, async (_target, _id, afterSeq, limit) => {
    calls.push(afterSeq)
    assert.equal(limit, 20)
    return { committedSeq: Math.min(afterSeq + 20, 45), result: { page: { hasMoreAfter: afterSeq + 20 < 45 } } }
  })
  assert.deepEqual(calls, [4, 24, 44])
})
