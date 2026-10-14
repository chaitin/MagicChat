import assert from "node:assert/strict"
import test from "node:test"

import { GROUP_AVATAR_OUTPUT_SIZE } from "@/components/avatar/group-avatar-cache"
import { getAvatarFallbackColor, getAvatarFallbackIconSize, getGroupAvatarFallbackIconSize, getGroupAvatarGridSize, getGroupAvatarTileRects, selectGroupAvatarMembers, type AvatarMember } from "@/components/avatar/avatar-strategy"

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

test("fractional-density nine-grid shares boundaries and fills the original avatar size", () => {
  const ratio = 2.55
  const tiles = getGroupAvatarTileRects(9, 44, ratio)
  assert.equal(tiles.length, 9)
  assert.equal(tiles[0].left, 0)
  assert.equal(tiles[0].top, 0)
  assert.ok(Math.abs(tiles[1].left * ratio - 37) < 1e-10)
  assert.ok(Math.abs(tiles[2].left * ratio - 75) < 1e-10)
  assert.ok(Math.abs(tiles[2].left + tiles[2].width - 44) < 1e-10)
  assert.ok(Math.abs(tiles[8].top + tiles[8].height - 44) < 1e-10)
  assert.ok(tiles[1].width > tiles[0].width)
})

test("full grids have no gaps at adjacent edges across avatar sizes and screen densities", () => {
  for (const size of [24, 28, 36, 40, 44, 48, 72, 74]) {
    for (const ratio of [1, 1.5, 2, 2.55, 2.625, 3, 3.5, 4]) {
      for (const count of [4, 9]) {
        const columns = getGroupAvatarGridSize(count)
        const tiles = getGroupAvatarTileRects(count, size, ratio)
        tiles.forEach((tile, index) => {
          assert.ok(tile.width > 0 && tile.height > 0)
          if (index % columns < columns - 1) {
            assert.ok(Math.abs(tile.left + tile.width - tiles[index + 1].left) < 1e-10)
          } else {
            assert.ok(Math.abs(tile.left + tile.width - size) < 1e-10)
          }
          if (index + columns < count) {
            assert.ok(Math.abs(tile.top + tile.height - tiles[index + columns].top) < 1e-10)
          } else {
            assert.ok(Math.abs(tile.top + tile.height - size) < 1e-10)
          }
        })
      }
    }
  }
})

test("incomplete avatar rows remain centered and bounded after pixel alignment", () => {
  for (let count = 1; count <= 9; count += 1) {
    const size = 44
    const ratio = 2.55
    const columns = getGroupAvatarGridSize(count)
    const tiles = getGroupAvatarTileRects(count, size, ratio)
    const first = tiles[0]
    const last = tiles.at(-1)!
    assert.ok(Math.abs(first.top + last.top + last.height - size) <= 1 / ratio)
    for (let start = 0; start < count; start += columns) {
      const row = tiles.slice(start, start + columns)
      const right = row.at(-1)!
      assert.ok(Math.abs(row[0].left + right.left + right.width - size) <= 1 / ratio)
    }
    tiles.forEach((tile) => {
      assert.ok(tile.left >= 0 && tile.top >= 0)
      assert.ok(tile.left + tile.width <= size + 1e-10)
      assert.ok(tile.top + tile.height <= size + 1e-10)
    })
  }
  assert.deepEqual(getGroupAvatarTileRects(0, 44, 2.55), [])
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
