import assert from "node:assert/strict"
import test from "node:test"
import {
  buildCompositeAvatar,
  compositeSignature,
  selectGroupMembers,
} from "../src/main/account/avatar-composite.ts"

const member = (id: string, role: "owner" | "admin" | "member" = "member") => ({
  id,
  type: "user" as const,
  name: id,
  avatarUrl: "",
  role,
})

test("组合头像优先选择群主和管理员", () => {
  const selected = selectGroupMembers([
    member("member-1"),
    member("member-2"),
    member("admin", "admin"),
    member("owner", "owner"),
    member("member-3"),
  ])
  assert.deepEqual(
    selected.map(({ id }) => id),
    ["owner", "admin", "member-1", "member-2", "member-3"],
  )
})

test("组合头像签名与 SVG 输出保持稳定", async () => {
  const source = { version: 2, members: [{ id: "user-1" }] }
  assert.equal(compositeSignature(source), compositeSignature(source))

  const svg = await buildCompositeAvatar(
    [{ member: member("user-1") }],
    2,
    "dark",
    async () => new Uint8Array(),
  )
  assert.match(svg, /^<svg/)
  assert.match(svg, /#1e1e1e/)
})
