import assert from "node:assert/strict"
import test from "node:test"
import { orderedForwardMessageIds } from "../src/renderer/features/chat/hooks/use-message-selection.ts"
import { canForwardDesktopMessage } from "../src/renderer/features/chat/message-actions.ts"
import { collectForwardResults } from "../src/renderer/features/chat/forward-retry.ts"
import type { DesktopMessage } from "../src/shared/account-data.ts"

const base = { seq: 2, body: { type: "text", content: "hello" } } as DesktopMessage

test("selected messages are sent in sequence order rather than click order", () => {
  assert.deepEqual(
    orderedForwardMessageIds(
      new Map([
        ["later", 8],
        ["earlier", 2],
        ["middle", 5],
      ]),
    ),
    ["earlier", "middle", "later"],
  )
})

test("only persisted forwardable messages expose forwarding actions", () => {
  assert.equal(canForwardDesktopMessage(base), true)
  assert.equal(canForwardDesktopMessage({ ...base, deliveryStatus: "sending" }), false)
  assert.equal(canForwardDesktopMessage({ ...base, virtualType: "topic_source" }), false)
  assert.equal(canForwardDesktopMessage({ ...base, body: { type: "unsupported" } }), false)
  assert.equal(
    canForwardDesktopMessage({ ...base, body: { type: "revoked" } } as DesktopMessage),
    false,
  )
  assert.equal(
    canForwardDesktopMessage({ ...base, body: { type: "system_event" } } as DesktopMessage),
    false,
  )
  assert.equal(
    canForwardDesktopMessage({ ...base, body: { type: "choice" } } as DesktopMessage),
    false,
  )
})

test("partial forward retries only failed targets and never reselects sent targets", () => {
  const response = collectForwardResults(
    {
      sentCount: 1,
      failedCount: 1,
      results: [
        { conversationId: "sent", status: "sent", messages: [] },
        {
          conversationId: "failed",
          status: "failed",
          messages: [],
          error: { code: "denied", message: "不可发送" },
        },
      ],
    },
    new Set(["previously-sent"]),
  )
  assert.deepEqual(response.retryIds, ["failed"])
  assert.deepEqual([...response.sent], ["previously-sent", "sent"])
  assert.equal(response.failed.get("failed"), "不可发送")
})
