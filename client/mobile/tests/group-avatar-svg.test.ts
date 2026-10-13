import assert from "node:assert/strict"
import test from "node:test"

import { buildGroupAvatarSvg } from "../src/components/avatar/group-avatar-svg.ts"

test("group avatar SVG centers incomplete rows like Desktop", () => {
  const svg = buildGroupAvatarSvg([
    { type: "user" },
    { type: "app" },
    { type: "user" },
    { type: "app" },
    { type: "user" },
  ], "light", 256)

  assert.match(svg, /viewBox="0 0 256 256"/)
  assert.match(svg, /fill="#1485ee"/)
  assert.match(svg, /fill="#10aeff"/)
  assert.match(svg, /x="42\.66666666666667"/)
})

test("group avatar SVG keeps themed fallback without native-unsafe embedded images", () => {
  const svg = buildGroupAvatarSvg([
    { type: "user" },
    { type: "app" },
    { type: "user" },
  ], "dark", 256)

  assert.doesNotMatch(svg, /<image\b|data:image\//)
  assert.match(svg, /fill="#1196ff"/)
  assert.match(svg, /fill="#10aeff"/)
})
