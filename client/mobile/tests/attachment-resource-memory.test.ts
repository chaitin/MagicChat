import assert from "node:assert/strict"
import test from "node:test"

import {
  clearAttachmentResourceMemory,
  forgetAttachmentResource,
  forgetServerAttachmentResources,
  getRememberedAttachmentResource,
  hasLoadedAttachmentImage,
  markAttachmentImageLoaded,
  rememberAttachmentResource,
} from "@/data/resources/attachment-resource-memory"

const serverA = { id: "a", url: "https://a.example" }
const serverB = { id: "b", url: "https://b.example" }
const resource = {
  identity: "attachment:file-1",
  sizeBytes: 10,
  source: "cache" as const,
  uri: "file:///cache/file-1.png",
}

test("remembers attachment resources by server and file", () => {
  clearAttachmentResourceMemory()
  rememberAttachmentResource(serverA, "file-1", resource)

  assert.equal(getRememberedAttachmentResource(serverA, "file-1"), resource)
  assert.equal(getRememberedAttachmentResource(serverB, "file-1"), undefined)

  forgetAttachmentResource(serverA, "file-1")
  assert.equal(getRememberedAttachmentResource(serverA, "file-1"), undefined)
})

test("tracks decoded images and clears them with their server", () => {
  clearAttachmentResourceMemory()
  rememberAttachmentResource(serverA, "file-1", resource)
  markAttachmentImageLoaded(resource.uri)
  assert.equal(hasLoadedAttachmentImage(resource.uri), true)

  forgetServerAttachmentResources(serverA)
  assert.equal(getRememberedAttachmentResource(serverA, "file-1"), undefined)
  assert.equal(hasLoadedAttachmentImage(resource.uri), false)
})
