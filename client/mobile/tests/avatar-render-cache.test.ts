import assert from "node:assert/strict"
import test from "node:test"

import {
  clearAvatarRenderCache,
  getCachedAvatarFormat,
  getCachedAvatarSvg,
  setCachedAvatarFormat,
  setCachedAvatarSvg,
} from "@/components/avatar/avatar-render-cache"

test("reuses avatar format and SVG content during the process lifetime", () => {
  clearAvatarRenderCache()
  setCachedAvatarFormat("file://bitmap", false)
  setCachedAvatarFormat("file://vector", true)
  setCachedAvatarSvg("file://vector", '<svg viewBox="0 0 1 1" />')

  assert.equal(getCachedAvatarFormat("file://bitmap"), false)
  assert.equal(getCachedAvatarFormat("file://vector"), true)
  assert.equal(
    getCachedAvatarSvg("file://vector"),
    '<svg viewBox="0 0 1 1" />'
  )

  clearAvatarRenderCache()
  assert.equal(getCachedAvatarFormat("file://bitmap"), undefined)
  assert.equal(getCachedAvatarSvg("file://vector"), undefined)
})
