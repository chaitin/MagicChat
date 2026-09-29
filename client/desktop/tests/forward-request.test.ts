import assert from "node:assert/strict"
import test from "node:test"
import {
  normalizeForwardResponse,
  validateForwardRequest,
} from "../src/main/account/forward-request.ts"

const source = "00000000-0000-4000-8000-000000000001"
const first = "00000000-0000-4000-8000-000000000002"
const second = "00000000-0000-4000-8000-000000000003"
const target = "00000000-0000-4000-8000-000000000004"
const request = {
  sourceConversationId: source,
  clientForwardId: crypto.randomUUID(),
  messageIds: [first, second],
  targetConversationIds: [target],
  mode: "merged" as const,
}

test("forward request deduplicates targets and preserves selected message order", () => {
  assert.deepEqual(
    validateForwardRequest({
      ...request,
      messageIds: [second, first, second],
      targetConversationIds: [target, target],
    }),
    { ...request, messageIds: [second, first] },
  )
})

test("merged forward requires two messages; malformed or oversized requests are rejected", () => {
  assert.throws(() => validateForwardRequest({ ...request, messageIds: [first] }))
  assert.throws(() => validateForwardRequest({ ...request, messageIds: [first, "invalid"] }))
  assert.throws(() => validateForwardRequest({ ...request, targetConversationIds: [] }))
  assert.throws(() =>
    validateForwardRequest({ ...request, targetConversationIds: Array(21).fill(target) }),
  )
  assert.throws(() => validateForwardRequest({ ...request, messageIds: Array(51).fill(first) }))
})

test("partial success preserves each target and parses only sent messages", () => {
  const parsed: string[] = []
  const response = normalizeForwardResponse(
    {
      sent_count: 1,
      failed_count: 1,
      results: [
        { conversation_id: target, status: "sent", messages: [{ id: first }] },
        {
          conversation_id: source,
          status: "failed",
          error: { code: "forbidden", message: "不可发送" },
        },
      ],
    },
    [target, source],
    (message, conversationId) => {
      parsed.push(conversationId)
      return message
    },
  )
  assert.equal(response.sentCount, 1)
  assert.deepEqual(parsed, [target])
  assert.deepEqual(response.results[1], {
    conversationId: source,
    status: "failed",
    messages: [],
    error: { code: "forbidden", message: "不可发送" },
  })
})

test("forward response rejects duplicate targets and mismatched counts", () => {
  const sent = { conversation_id: target, status: "sent", messages: [{ id: first }] }
  const parse = (message: unknown) => message
  assert.throws(() =>
    normalizeForwardResponse(
      { sent_count: 2, failed_count: 0, results: [sent, sent] },
      [target, source],
      parse,
    ),
  )
  assert.throws(() =>
    normalizeForwardResponse({ sent_count: 0, failed_count: 1, results: [sent] }, [target], parse),
  )
})
