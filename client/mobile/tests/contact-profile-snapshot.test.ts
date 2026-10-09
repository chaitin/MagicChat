import assert from "node:assert/strict"
import test from "node:test"

import type { ContactUser } from "../src/core/models.ts"
import { applyContactProfileBatch } from "../src/data/contacts/contact-profile-snapshot.ts"

const user = (id: string, name: string) => ({ id, name, type: "user" }) as ContactUser

test("a resolved batch updates only its IDs and preserves unrelated cached profiles", () => {
  const original = {
    directory: { apps: [], groups: [], userIds: ["one", "two", "three"] },
    usersById: { one: user("one", "original"), three: user("three", "unchanged") },
    unavailableUserIds: new Set(["two"]),
  }
  const updated = applyContactProfileBatch(original, ["one", "two"], new Map([
    ["one", { profile: user("one", "newest persisted version"), missing_until: null }],
    ["two", { profile: null, missing_until: 200 }],
  ]), 100)
  assert.equal(updated.usersById.one.name, "newest persisted version")
  assert.equal(updated.usersById.three.name, "unchanged")
  assert.equal(updated.unavailableUserIds.has("two"), true)
  assert.equal(original.usersById.one.name, "original")
  assert.equal(original.directory, updated.directory)
})

test("a disappeared or expired profile clears stale availability", () => {
  const original = {
    directory: { apps: [], groups: [], userIds: ["one", "two"] },
    usersById: { one: user("one", "old") },
    unavailableUserIds: new Set(["two"]),
  }
  const updated = applyContactProfileBatch(original, ["one", "two"], new Map([
    ["two", { profile: null, missing_until: 100 }],
  ]), 100)
  assert.equal(updated.usersById.one, undefined)
  assert.equal(updated.unavailableUserIds.has("two"), false)
  assert.equal(original.unavailableUserIds.has("two"), true)
})
