import assert from "node:assert/strict"
import test from "node:test"
import { numberedAttachmentFileName } from "../src/main/account/attachment-file-name.ts"

test("同名附件在扩展名前追加递增编号", () => {
  assert.equal(numberedAttachmentFileName("报告.pdf", 0), "报告.pdf")
  assert.equal(numberedAttachmentFileName("报告.pdf", 1), "报告.1.pdf")
  assert.equal(numberedAttachmentFileName("报告.pdf", 2), "报告.2.pdf")
  assert.equal(numberedAttachmentFileName("归档.tar.gz", 1), "归档.tar.1.gz")
  assert.equal(numberedAttachmentFileName("README", 1), "README.1")
  assert.ok(Buffer.byteLength(numberedAttachmentFileName(`${"长".repeat(255)}.pdf`, 99)) <= 255)
})
