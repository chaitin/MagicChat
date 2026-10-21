import assert from "node:assert/strict"
import test from "node:test"
import { contactLink, parseContactLink } from "../../shared/contact-links.ts"
import { normalizeOutgoingRichMessageBody } from "../src/main/account/rich-message-input.ts"

const id = "550e8400-e29b-41d4-a716-446655440000"

test("通讯录三类协议与entity_card发送类型对应", () => {
  for (const type of ["user", "app", "group"] as const) {
    const url = contactLink({ type, id })
    assert.deepEqual(parseContactLink(url), { type, id })
    assert.deepEqual(
      normalizeOutgoingRichMessageBody({ type: "entity_card", entityType: type, entityId: id }),
      {
        type: "entity_card",
        entity_type: type,
        entity_id: id,
      },
    )
  }
})

test("协议严格限制目标、UUID、参数和片段，不允许跨服务器", () => {
  for (const value of [
    "jiying://contact/no-id",
    `jiying://task/${id}`,
    `jiying://app/${id}?server=other`,
    `jiying://app/${id}#extra`,
    `jiying://app/${id}/`,
    `jiying://app@evil/${id}`,
    `jiying://app/%35${id.slice(1)}`,
    `jiying://app/${id}\n`,
    "javascript:alert(1)",
  ])
    assert.equal(parseContactLink(value), null, value)
})
