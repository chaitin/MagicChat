import assert from "node:assert/strict"
import test from "node:test"
import { normalizeDesktopMessageDetails } from "../src/main/account/message-normalizer.ts"

test("解析本人撤回消息的可编辑正文", () => {
  const details = normalizeDesktopMessageDetails({
    revoked_at: "2026-09-15T03:00:00Z",
    editable_body: { type: "text", content: "撤回前的正文" },
  })

  assert.deepEqual(details.body, {
    type: "revoked",
    editableBody: { type: "text", content: "撤回前的正文" },
  })
})

test("撤回的非文字消息不提供可编辑正文", () => {
  const details = normalizeDesktopMessageDetails({
    revoked_at: "2026-09-15T03:00:00Z",
    editable_body: { type: "image", file_id: "file-1" },
  })

  assert.deepEqual(details.body, { type: "revoked" })
})
