import assert from "node:assert/strict"
import test from "node:test"
import { ProjectTaskManager } from "../src/main/account/project-task-manager.ts"
import { MAX_TASK_IMAGE_BYTES } from "../src/shared/task-image.ts"

const base = { targetId: "account", projectId: "project-1" }
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer
const upload = { ...base, bytes: png, name: "截图.png", contentType: "image/png" }
const managerFor = (client: Record<string, unknown>) => new ProjectTaskManager(client as never)

test("图片上传先确认当前项目权限，再通过file字段上传原始字节并返回文件ID", async () => {
  const calls: unknown[] = []
  const manager = managerFor({
    get: async (path: string) => {
      calls.push(["GET", path])
      return {}
    },
    postFile: async (path: string, fields: unknown, file: unknown) => {
      calls.push(["POST", path, fields, file])
      return { file: { id: "file-1", size_bytes: png.byteLength } }
    },
  })
  assert.deepEqual(await manager.uploadImage(upload), {
    fileId: "file-1",
    sizeBytes: png.byteLength,
  })
  assert.deepEqual(calls, [
    ["GET", "/api/client/projects/project-1/tasks?limit=1"],
    [
      "POST",
      "/api/client/temporary-files",
      {},
      { bytes: png, name: upload.name, fieldName: "file", contentType: "image/png" },
    ],
  ])
})

test("非图片、伪造MIME、空字节、超限和磁盘路径不能通过任务图片入口", async () => {
  let called = false
  const manager = managerFor({
    get: async () => {
      called = true
    },
  })
  for (const input of [
    { ...upload, bytes: "path" },
    { ...upload, bytes: undefined, path: "/tmp/private" },
    { ...upload, bytes: new ArrayBuffer(0) },
    { ...upload, bytes: new ArrayBuffer(MAX_TASK_IMAGE_BYTES + 1) },
    { ...upload, contentType: "image/svg+xml" },
    { ...upload, contentType: "image/jpeg" },
  ])
    await assert.rejects(manager.uploadImage(input as never))
  assert.equal(called, false)
})

test("账号已失去项目访问时，不继续上传或签发图片地址", async () => {
  const manager = managerFor({
    get: async () => {
      throw new Error("项目访问被拒绝")
    },
    postFile: async () => assert.fail("不可上传"),
    post: async () => assert.fail("不可读取"),
  })
  await assert.rejects(manager.uploadImage(upload), /项目访问被拒绝/)
  await assert.rejects(manager.readImage({ ...base, fileId: "file-1" }), /项目访问被拒绝/)
})

test("详情图片读取使用当前任务权限并按文件ID选取签名URL", async () => {
  const calls: unknown[] = []
  const manager = managerFor({
    get: async (path: string) => {
      calls.push(["GET", path])
      return {}
    },
    post: async (path: string, body: unknown) => {
      calls.push(["POST", path, body])
      return {
        urls: [
          { file_id: "other", url: "https://example.com/other" },
          { file_id: "file-1", url: "https://example.com/image?signature=temporary" },
        ],
      }
    },
  })
  assert.deepEqual(await manager.readImage({ ...base, taskId: "task-1", fileId: "file-1" }), {
    url: "https://example.com/image?signature=temporary",
  })
  assert.deepEqual(calls, [
    ["GET", "/api/client/projects/project-1/tasks/task-1"],
    ["POST", "/api/client/temporary-files/read-urls", { file_ids: ["file-1"] }],
  ])
})

test("访问地址必须匹配文件ID且使用HTTP(S)，拒绝脚本、本地文件和带账号密码的地址", async () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/private",
    "data:image/png;base64,abc",
    "https://user:password@example.com/image",
    "not-a-url",
  ]) {
    const manager = managerFor({
      get: async () => ({}),
      post: async () => ({ urls: [{ file_id: "file-1", url }] }),
    })
    await assert.rejects(manager.readImage({ ...base, fileId: "file-1" }))
  }
  const missing = managerFor({
    get: async () => ({}),
    post: async () => ({ urls: [{ file_id: "other", url: "https://example.com/image" }] }),
  })
  await assert.rejects(missing.readImage({ ...base, fileId: "file-1" }))
})
