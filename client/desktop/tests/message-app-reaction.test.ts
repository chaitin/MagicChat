import assert from "node:assert/strict"
import test from "node:test"

import { normalizeDesktopMessageDetails } from "../src/main/account/message-normalizer.ts"

test("收到回执保留应用身份，并与用户回应共存", () => {
  const { reactions } = normalizeDesktopMessageDetails({
    body: { type: "text", content: "hello" },
    reactions: [{
      text: "收到",
      count: 2,
      reacted_by_me: false,
      users: [
        { id: "app-1", type: "app", name: "助手" },
        { id: "user-1" },
      ],
    }],
  })
  assert.deepEqual(reactions, [{
    text: "收到",
    count: 2,
    reactedByMe: false,
    users: [{ id: "app-1", type: "app", name: "助手" }, { id: "user-1", name: "" }],
  }])
})
