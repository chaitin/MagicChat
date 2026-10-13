import assert from "node:assert/strict"
import test from "node:test"
import {
  markdownAttachmentFileId,
  markdownAttachmentSource,
} from "../../shared/markdown-attachment.ts"
import {
  MAX_TASK_IMAGE_BYTES,
  hasTaskImageUpload,
  insertTaskImages,
  removeTaskImageUpload,
  replaceTaskImageUpload,
  taskImageMarkdown,
  taskImageSelectionAfterUpload,
  taskImageUploadSource,
  taskImageValidationError,
} from "../src/shared/task-image.ts"

test("跨端附件引用只接受不含路径或其他协议的文件ID", () => {
  for (const id of ["file-1", "abc_DEF-123", "bdb47f4a-6667-4a9f-80e9-8e43f2f50cab"]) {
    assert.equal(markdownAttachmentFileId(markdownAttachmentSource(id)), id)
  }
  for (const source of [
    "attachment:",
    "attachment:../other",
    "attachment:foo/bar",
    "attachment:foo?token=x",
    "attachment:foo%2Fbar",
    "attachment:foo\n",
    "attachment:" + "a".repeat(129),
    "javascript:alert(1)",
    "file:///tmp/image.png",
    "data:image/png;base64,abc",
    "blob:image",
    null,
  ]) {
    assert.equal(markdownAttachmentFileId(source), null)
  }
  assert.throws(() => markdownAttachmentSource("bad/id"))
})

test("图片粘贴限制为Web一致的栅格图片格式与10MiB", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]) {
    assert.equal(taskImageValidationError({ type, size: MAX_TASK_IMAGE_BYTES }), null)
  }
  for (const file of [
    { type: "image/svg+xml", size: 1 },
    { type: "image/png", size: 0 },
    { type: "image/png", size: MAX_TASK_IMAGE_BYTES + 1 },
  ]) {
    assert.ok(taskImageValidationError(file))
  }
})

test("光标插入或替换选区，保留前后内容及多张图片顺序", () => {
  const markdown = [
    taskImageMarkdown("甲.png", taskImageUploadSource("first")),
    taskImageMarkdown("乙.png", taskImageUploadSource("second")),
  ]
  const inserted = insertTaskImages("前文替换后文", 2, 4, markdown)
  assert.equal(inserted.text, `前文\n${markdown.join("\n")}\n后文`)
  assert.equal(inserted.text.slice(inserted.caret), "后文")
  assert.equal(insertTaskImages("", 0, 0, markdown).text, markdown.join("\n") + "\n")
  assert.ok(hasTaskImageUpload(inserted.text))
})

test("文件名转义Markdown，防止方括号、反斜线和换行破坏占位", () => {
  const image = taskImageMarkdown("截图[1]\\x\n.png", taskImageUploadSource("first"))
  assert.equal(image, "![截图\\[1\\]\\\\x .png](task-upload:first)")
  assert.equal(removeTaskImageUpload("前" + image + "后", "first"), "前后")
})

test("上传逆序完成仍保留顺序和后来输入，已删除占位不恢复", () => {
  let current = insertTaskImages("前文", 2, 2, [
    taskImageMarkdown("甲", taskImageUploadSource("first")),
    taskImageMarkdown("乙", taskImageUploadSource("second")),
  ]).text
  current += "后来输入"
  current = replaceTaskImageUpload(current, "second", "file-2")
  current = replaceTaskImageUpload(current, "first", "file-1")
  assert.ok(current.indexOf("attachment:file-1") < current.indexOf("attachment:file-2"))
  assert.ok(current.endsWith("后来输入"))
  assert.equal(hasTaskImageUpload(current), false)
  const removed = removeTaskImageUpload(
    "前" + taskImageMarkdown("甲", taskImageUploadSource("first")) + "后",
    "first",
  )
  assert.equal(replaceTaskImageUpload(removed, "first", "file-1"), "前后")
  assert.equal(
    replaceTaskImageUpload("![用户改了说明](task-upload:first)", "first", "file-1"),
    "![用户改了说明](attachment:file-1)",
  )
})

test("异步替换调整光标和选区，不把输入光标推到文本末尾", () => {
  const text =
    "前文" + taskImageMarkdown("图片", taskImageUploadSource("first-long-id")) + "后文正在编辑结尾"
  const start = text.indexOf("正在")
  const result = taskImageSelectionAfterUpload(text, "first-long-id", "file-1", start, start + 4)
  assert.equal(result.text.slice(result.start, result.end), "正在编辑")
  const before = taskImageSelectionAfterUpload(text, "first-long-id", "file-1", 0, 1)
  assert.equal(before.start, 0)
  assert.equal(before.end, 1)
})
