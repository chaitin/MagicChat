import assert from "node:assert/strict"
import test from "node:test"

import {
  isSvgContent,
  isSvgUrl,
  normalizeAvatarSvgContent,
} from "@/components/avatar/avatar-resource-format"

test("detects SVG URLs and data URIs", () => {
  assert.equal(isSvgUrl("https://example.com/avatar.svg?version=1"), true)
  assert.equal(isSvgUrl("data:image/svg+xml,%3Csvg%3E"), true)
  assert.equal(isSvgUrl("https://example.com/avatar"), false)
})

test("detects SVG from extensionless cached content", () => {
  assert.equal(
    isSvgContent('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    true
  )
  assert.equal(isSvgContent("\uFEFF  <svg viewBox=\"0 0 24 24\"></svg>"), true)
  assert.equal(isSvgContent("\u0089PNG\r\n\u001a\n"), false)
})

test("adds a viewBox from intrinsic SVG dimensions", () => {
  assert.equal(
    normalizeAvatarSvgContent(
      '<?xml version="1.0"?><svg width="640px" height="480"><path d="M0 0" /></svg>'
    ),
    '<?xml version="1.0"?><svg width="640px" height="480" viewBox="0 0 640 480"><path d="M0 0" /></svg>'
  )
})

test("preserves SVGs with a viewBox or non-intrinsic dimensions", () => {
  const withViewBox = '<svg viewBox="0 0 24 24" width="24" height="24" />'
  const percentageSize = '<svg width="100%" height="100%" />'
  assert.equal(normalizeAvatarSvgContent(withViewBox), withViewBox)
  assert.equal(normalizeAvatarSvgContent(percentageSize), percentageSize)
})
