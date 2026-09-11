import assert from "node:assert/strict"
import test from "node:test"

import { linkifyMessageText } from "../src/domain/messages/message-links.ts"

test("finds HTTP links with ports, paths, queries, and hashes", () => {
  const url =
    "https://api.example.com:8080/v1/users?id=123&active=true#result-1"

  assert.deepEqual(linkifyMessageText(`查看 ${url} 的结果`), [
    { type: "text", value: "查看 " },
    { href: url, type: "link", value: url },
    { type: "text", value: " 的结果" },
  ])
})

test("supports multiple links and ordinary percent signs", () => {
  assert.deepEqual(
    linkifyMessageText(
      "http://api:80/a_%zz?value=50%#part 和 https://example.com"
    ),
    [
      {
        href: "http://api:80/a_%zz?value=50%#part",
        type: "link",
        value: "http://api:80/a_%zz?value=50%#part",
      },
      { type: "text", value: " 和 " },
      {
        href: "https://example.com",
        type: "link",
        value: "https://example.com",
      },
    ]
  )
})

test("keeps sentence punctuation and adjacent Chinese text out of links", () => {
  assert.deepEqual(
    linkifyMessageText("请看（https://example.com/a_(b)），谢谢。"),
    [
      { type: "text", value: "请看（" },
      {
        href: "https://example.com/a_(b)",
        type: "link",
        value: "https://example.com/a_(b)",
      },
      { type: "text", value: "），谢谢。" },
    ]
  )

  const url = "http://localhost:20070/chat?conversation_id=abc-123"
  assert.deepEqual(linkifyMessageText(`啊啊${url}阿斯顿`), [
    { type: "text", value: "啊啊" },
    { href: url, type: "link", value: url },
    { type: "text", value: "阿斯顿" },
  ])
})

test("does not link unsupported URL candidates", () => {
  for (const value of [
    "www.example.com",
    "ftp://example.com/file",
    "https://user:pass@example.com",
    "https://example.com:0/path",
    "https://example.com:65536/path",
  ]) {
    assert.deepEqual(linkifyMessageText(value), [{ type: "text", value }])
  }
})
