import assert from "node:assert/strict"
import test from "node:test"
import { normalizeDesktopMessageChoiceState } from "../src/main/account/message-normalizer.ts"

test("解析选择消息状态", () => {
  assert.deepEqual(
    normalizeDesktopMessageChoiceState({
      my_option_ids: ["option-2"],
      options: [
        { id: "option-1", response_count: 2 },
        { id: "option-2", response_count: 3 },
      ],
      response_count: 4,
    }),
    {
      myOptionIds: ["option-2"],
      options: [
        { id: "option-1", responseCount: 2 },
        { id: "option-2", responseCount: 3 },
      ],
      responseCount: 4,
    },
  )
})

test("拒绝结构不完整的选择消息状态", () => {
  assert.equal(normalizeDesktopMessageChoiceState(undefined), undefined)
  assert.equal(normalizeDesktopMessageChoiceState({ options: [] }), undefined)
})
