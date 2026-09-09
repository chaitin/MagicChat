import assert from "node:assert/strict"
import test from "node:test"

import { GROUP_AVATAR_OUTPUT_SIZE } from "@/components/avatar/group-avatar-cache"
import { getAvatarFallbackColor, getAvatarFallbackIconSize, getGroupAvatarFallbackIconSize, getGroupAvatarGridSize, selectGroupAvatarMembers, type AvatarMember } from "@/components/avatar/avatar-strategy"

const member = (name: string, role: AvatarMember["role"] = "member"): AvatarMember => ({ avatar: "", name, nickname: name, role })

test("group avatars use four slots through four members and nine above four", () => {
  assert.equal(selectGroupAvatarMembers(Array.from({ length: 4 }, (_, i) => member(String(i)))).length, 4)
  assert.equal(selectGroupAvatarMembers(Array.from({ length: 5 }, (_, i) => member(String(i)))).length, 5)
  assert.equal(selectGroupAvatarMembers(Array.from({ length: 12 }, (_, i) => member(String(i)))).length, 9)
  assert.equal(getGroupAvatarGridSize(4), 2)
  assert.equal(getGroupAvatarGridSize(5), 3)
})

test("group members sort stably by role", () => {
  const selected = selectGroupAvatarMembers([member("m1"), member("a1", "admin"), member("o", "owner"), member("a2", "admin"), member("m2")])
  assert.deepEqual(selected.map(({ name }) => name), ["o", "a1", "a2", "m1", "m2"])
})

test("avatar types map to WeUI semantic colors", () => {
  assert.deepEqual(["app", "group", "user", "project"].map((type) => getAvatarFallbackColor(type as any)), ["blue", "yellow", "indigo", "orange"])
})

test("fallback icons match contact entry proportions without overflowing grid tiles", () => {
  assert.equal(getAvatarFallbackIconSize(44), 26)
  assert.equal(getAvatarFallbackIconSize(96), 32)
  assert.ok(getAvatarFallbackIconSize(40 / 3) < 40 / 3)
  const generatedAt40 = getGroupAvatarFallbackIconSize(40 / 3) * (GROUP_AVATAR_OUTPUT_SIZE / 40)
  const generatedAt48 = getGroupAvatarFallbackIconSize(48 / 3) * (GROUP_AVATAR_OUTPUT_SIZE / 48)
  assert.ok(Math.abs(generatedAt40 - generatedAt48) < Number.EPSILON * 100)
})
