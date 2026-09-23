import assert from "node:assert/strict"
import test from "node:test"

import { normalizeConversationReadUpdatedPayload } from "../src/realtime/realtime-payload.ts"
import { realtimeEvents } from "../src/realtime/realtime-protocol.ts"

test("read cursor event validates conversation and sequence", () => {
  assert.equal(realtimeEvents.conversationReadUpdated, "conversation.read_updated")
  assert.deepEqual(normalizeConversationReadUpdatedPayload({ conversation_id: "conversation-1", last_read_seq: 4 }), {
    conversationId: "conversation-1", lastReadSeq: 4,
  })
  assert.throws(() => normalizeConversationReadUpdatedPayload({ conversation_id: "conversation-1", last_read_seq: -1 }))
  assert.throws(() => normalizeConversationReadUpdatedPayload({ conversation_id: "", last_read_seq: 4 }))
})
