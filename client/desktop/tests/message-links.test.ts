import assert from "node:assert/strict"
import test from "node:test"
import { linkifyMessageText } from "../src/renderer/lib/message-links.ts"

test("识别带端口、路径、查询参数和锚点的网页链接", () => {
  const url = "https://api.example.com:8080/v1/users?id=123&active=true#result-1"
  assert.deepEqual(linkifyMessageText(`查看 ${url} 的结果`), [
    { type: "text", value: "查看 " },
    { type: "link", value: url, href: url },
    { type: "text", value: " 的结果" },
  ])
})

test("链接匹配在后续中文和句末标点前停止", () => {
  const url = "http://localhost:20070/chat?conversation_id=abc-123"
  assert.deepEqual(linkifyMessageText(`打开${url}查看详情。`), [
    { type: "text", value: "打开" },
    { type: "link", value: url, href: url },
    { type: "text", value: "查看详情。" },
  ])
  assert.deepEqual(linkifyMessageText("请看（https://example.com/a_(b)），谢谢。"), [
    { type: "text", value: "请看（" },
    {
      type: "link",
      value: "https://example.com/a_(b)",
      href: "https://example.com/a_(b)",
    },
    { type: "text", value: "），谢谢。" },
  ])
})

test("不识别非 HTTP 链接和不安全或非法地址", () => {
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
