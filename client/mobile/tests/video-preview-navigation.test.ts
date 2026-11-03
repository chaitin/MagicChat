import assert from "node:assert/strict"
import test from "node:test"

import { buildVideoPreviewHref, buildVideoPreviewScope, parseVideoPreviewParams } from "@/navigation/video-preview"

const session = { id: "server", url: "https://server.example.test", userId: "user" }
const source = { fileId: "video-1", contentType: "video/mp4" as const, name: "clip.mp4", sizeBytes: 1024 }

test("视频预览路由只携带消息标识和会话范围，不携带临时播放地址", () => {
  const scope = buildVideoPreviewScope(session, 1)
  const route = buildVideoPreviewHref(source, scope) as any
  assert.equal(route.pathname, "/video-preview")
  assert.deepEqual(parseVideoPreviewParams(route.params), { source, scope })
  assert.equal("url" in route.params, false)
  assert.equal("uri" in route.params, false)
  assert.deepEqual(parseVideoPreviewParams({
    ...route.params, fileId: ["video-1"], sizeBytes: ["1024"],
  }), { source, scope })
})

test("预览范围区分账号、服务器URL和认证世代", () => {
  const scope = buildVideoPreviewScope(session, 1)
  assert.notEqual(buildVideoPreviewScope({ ...session, userId: "other" }, 1), scope)
  assert.notEqual(buildVideoPreviewScope({ ...session, url: "https://other.example.test" }, 1), scope)
  assert.notEqual(buildVideoPreviewScope(session, 2), scope)
})

test("非法或缺失的视频参数不进入下载流程", () => {
  const params = { ...source, sizeBytes: "1024", scope: "scope" }
  for (const invalid of [
    { fileId: "" }, { name: "" }, { scope: "" }, { sizeBytes: "" },
    { sizeBytes: "-1" }, { sizeBytes: "NaN" }, { sizeBytes: "Infinity" },
    { contentType: "video/quicktime" },
  ]) {
    assert.equal(parseVideoPreviewParams({ ...params, ...invalid }), null)
  }
})
