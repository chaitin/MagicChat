import assert from "node:assert/strict"
import test from "node:test"
import { isSafeWebUrl } from "../src/shared/desktop.ts"
import { normalizeSingleLinkMessageURL } from "../src/shared/message-link.ts"

test("纯链接消息会标准化为 HTTP 网页地址", () => {
  assert.equal(
    normalizeSingleLinkMessageURL("https://example.com/path"),
    "https://example.com/path",
  )
  assert.equal(
    normalizeSingleLinkMessageURL("www.example.com/path"),
    "https://www.example.com/path",
  )
  assert.equal(normalizeSingleLinkMessageURL("查看 https://example.com"), null)
  assert.equal(normalizeSingleLinkMessageURL("javascript:alert(1)"), null)
})

test("消息链接只允许无凭据的 HTTP 网页地址", () => {
  assert.equal(isSafeWebUrl("https://example.com/path?q=1"), true)
  assert.equal(isSafeWebUrl("http://example.com"), true)
  assert.equal(isSafeWebUrl("javascript:alert(1)"), false)
  assert.equal(isSafeWebUrl("file:///tmp/example"), false)
  assert.equal(isSafeWebUrl("https://user:password@example.com"), false)
  assert.equal(isSafeWebUrl("not-a-url"), false)
})
