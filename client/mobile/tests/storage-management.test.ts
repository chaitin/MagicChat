import assert from "node:assert/strict"
import test from "node:test"

import { formatStorageSize } from "../src/features/storage/storage-model.ts"

test("formats approximate storage sizes", () => {
  assert.equal(formatStorageSize(0), "0 B")
  assert.equal(formatStorageSize(1536), "1.5 KB")
  assert.equal(formatStorageSize(1024 ** 2), "1.0 MB")
})
