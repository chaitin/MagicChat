import assert from "node:assert/strict"
import test from "node:test"

import { classifyQrContent } from "@/features/qr-scanner/qr-content-classifier"

test("normalizes absolute HTTP and HTTPS URLs", () => {
  assert.deepEqual(classifyQrContent("https://example.com/a?b=1"), {
    kind: "web",
    url: "https://example.com/a?b=1",
  })
  assert.deepEqual(classifyQrContent("  HTTP://EXAMPLE.COM/path  "), {
    kind: "web",
    url: "http://example.com/path",
  })
})

test("rejects relative URLs, unsafe schemes, empty input, and URLs without a hostname", () => {
  for (const content of [
    "",
    "   ",
    "example.com",
    "/relative",
    "javascript:alert(1)",
    "file:///tmp/a",
    "data:text/plain,hello",
    "custom://example.com",
    "http://",
    "https://?query=value",
  ]) {
    assert.deepEqual(classifyQrContent(content), { kind: "text", content })
  }
})

test("preserves text content exactly", () => {
  const content = "  first line\nsecond line  "
  assert.deepEqual(classifyQrContent(content), { kind: "text", content })
})
