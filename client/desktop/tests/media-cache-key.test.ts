import assert from "node:assert/strict"
import test from "node:test"
import { createMediaCacheKey } from "../src/main/account/media-cache-key.ts"

test("媒体缓存键只由账号、分类和文件标识决定", () => {
  const first = createMediaCacheKey("server\0user", "attachment", "file-1")
  const second = createMediaCacheKey("server\0user", "attachment", "file-1")
  assert.equal(first, second)
  assert.notEqual(first, createMediaCacheKey("server\0user", "video", "file-1"))
  assert.notEqual(first, createMediaCacheKey("server\0user", "attachment", "file-2"))
})
