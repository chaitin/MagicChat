import assert from "node:assert/strict"
import test from "node:test"

import {
  createGroupAvatarIdentity,
  GroupAvatarGenerationLimiter,
  GROUP_AVATAR_GENERATOR_VERSION,
  GROUP_AVATAR_OUTPUT_SIZE,
  GroupAvatarGenerationEpoch,
  GroupAvatarMemoryCache,
} from "@/components/avatar/group-avatar-cache"
import { getGroupAvatarGridSize, selectGroupAvatarMembers, type AvatarMember } from "@/components/avatar/avatar-strategy"

const server = { id: "s", url: "https://example.test" }
const tokens = { background1: "#fff", fallbackBackground: "#00f", textOnColor: "#fff" }
const members: AvatarMember[] = [
  { avatar: "a.gif", name: "one", nickname: "One", role: "member" },
  { avatar: "b", name: "two", nickname: "Two", role: "owner" },
]
function identity(overrides: Partial<Parameters<typeof createGroupAvatarIdentity>[0]> = {}) {
  return createGroupAvatarIdentity({ entries: selectGroupAvatarMembers(members), gridSize: 2, server, theme: "light", tokens, ...overrides })
}

test("group avatar identity is stable, short, and visually sensitive", () => {
  assert.equal(identity(), identity())
  assert.match(identity(), /^group-avatar:[0-9a-f]{16}$/)
  assert.notEqual(identity(), identity({ entries: [...selectGroupAvatarMembers(members)].reverse() }))
  assert.notEqual(identity(), identity({ entries: [{ ...members[0], avatar: "changed" }, members[1]] }))
  assert.notEqual(identity(), identity({ entries: [{ ...members[0], nickname: "Changed" }, members[1]] }))
  assert.notEqual(identity(), identity({ gridSize: 3 }))
  assert.notEqual(identity(), identity({ theme: "dark" }))
  assert.notEqual(identity(), identity({ tokens: { ...tokens, background1: "#000" } }))
  assert.notEqual(identity(), identity({ version: 99 }))
})

test("group avatar output uses a bounded cache-friendly size", () => {
  assert.equal(GROUP_AVATAR_OUTPUT_SIZE, 192)
  assert.ok(GROUP_AVATAR_GENERATOR_VERSION >= 9)
})

test("group avatar generation limiter bounds work and releases cancelled owners", () => {
  const limiter = new GroupAvatarGenerationLimiter(2)
  const started: number[] = []
  const releases: (() => void)[] = []
  const cancels = [1, 2, 3, 4].map((id) =>
    limiter.schedule((release) => {
      started.push(id)
      releases.push(release)
    })
  )

  assert.deepEqual(started, [1, 2])
  cancels[2]?.()
  cancels[0]?.()
  assert.deepEqual(started, [1, 2, 4])
  releases[1]?.()
  releases[2]?.()
})

test("grid threshold and role ordering remain deterministic", () => {
  assert.equal(getGroupAvatarGridSize(4), 2)
  assert.equal(getGroupAvatarGridSize(5), 3)
  assert.deepEqual(selectGroupAvatarMembers(members).map((x) => x.name), ["two", "one"])
})

test("group avatar memory cache is LRU and server-clearable", () => {
  const cache = new GroupAvatarMemoryCache<number>(2)
  cache.set("s\nu\na", 1); cache.set("s\nu\nb", 2); assert.equal(cache.get("s\nu\na"), 1)
  cache.set("s\nu\nc", 3); assert.equal(cache.get("s\nu\nb"), undefined)
  cache.clearServer({ id: "s", url: "u" }); assert.equal(cache.get("s\nu\na"), undefined)
})

test("cache clearing invalidates only matching generation epochs", () => {
  const epochs = new GroupAvatarGenerationEpoch()
  const otherServer = { id: "other", url: "https://other.test" }
  const first = epochs.capture(server)
  const other = epochs.capture(otherServer)

  epochs.invalidate(server)
  assert.equal(epochs.isCurrent(server, first), false)
  assert.equal(epochs.isCurrent(otherServer, other), true)

  const current = epochs.capture(server)
  epochs.invalidate(null)
  assert.equal(epochs.isCurrent(server, current), false)
  assert.equal(epochs.isCurrent(otherServer, other), false)
})
