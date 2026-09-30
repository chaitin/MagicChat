import assert from "node:assert/strict"
import test from "node:test"
import {
  CONTACT_ROW_HEIGHT,
  visibleContactRanges,
} from "../src/renderer/features/contacts/contacts-virtual-list.ts"

test("长分组只渲染视口附近的条目，后续分组仍可定位", () => {
  const sections = [
    { key: "users", count: 1_000, expanded: true },
    { key: "apps", count: 500, expanded: true },
  ]
  const first = visibleContactRanges(sections, 0, 330)
  assert.deepEqual(first.get("users"), { start: 0, end: 8 })
  assert.deepEqual(first.get("apps"), { start: 0, end: 0 })

  const next = visibleContactRanges(sections, 66_056, 330)
  assert.deepEqual(next.get("users"), { start: 997, end: 1_000 })
  assert.deepEqual(next.get("apps"), { start: 0, end: 8 })
})

test("折叠上方分组后，下方分组使用新的滚动位置", () => {
  const sections = [
    { key: "empty", count: 0, expanded: true },
    { key: "users", count: 1_000, expanded: false },
    { key: "apps", count: 100, expanded: true },
  ]
  const expanded = visibleContactRanges(
    sections.map((section) => ({ ...section, expanded: true })),
    0,
    CONTACT_ROW_HEIGHT,
  )
  assert.deepEqual(expanded.get("apps"), { start: 0, end: 0 })

  const ranges = visibleContactRanges(sections, 0, CONTACT_ROW_HEIGHT)
  assert.equal(ranges.has("empty"), false)
  assert.equal(ranges.has("users"), false)
  assert.deepEqual(ranges.get("apps"), { start: 0, end: 3 })
})
