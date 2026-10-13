import assert from "node:assert/strict"
import test from "node:test"
import { createUserSearchIndex, matchesUserSearch } from "../src/shared/user-search.ts"

const index = createUserSearchIndex({
  displayName: "小张",
  name: "张三",
  nickname: "小张",
  email: "Zhang.San@Example.com",
  phone: "+86 138-1234-5678",
})

test("负责人按姓名、昵称、邮箱、手机号及其片段搜索", () => {
  for (const query of [
    "张三",
    "张",
    "小张",
    "ZHANG.SAN",
    "@EXAMPLE.COM",
    "1381234",
    "5678",
    "138-1234",
    "+86 138 1234 5678",
    "１３８１２３４",
    "  小张  ",
  ]) {
    assert.equal(matchesUserSearch(index, query), true, query)
  }
  for (const query of ["李四", "missing@example.com", "1390000", "zs000", "---"]) {
    assert.equal(matchesUserSearch(index, query), false, query)
  }
})

test("姓名和昵称支持无声调全拼、片段、首字母及带空格拼音", () => {
  for (const query of [
    "zhangsan",
    "ZHANG",
    "san",
    "zs",
    "xiaozhang",
    "xz",
    "zhang san",
    "xiao zhang",
  ]) {
    assert.equal(matchesUserSearch(index, query), true, query)
  }
})

test("无权限或缺失字段不参与搜索，空搜索保留全部候选", () => {
  const missing = createUserSearchIndex({
    displayName: "未知成员",
    name: "",
    nickname: "",
    email: "",
    phone: "",
  })
  assert.equal(matchesUserSearch(missing, ""), true)
  assert.equal(matchesUserSearch(missing, "   "), true)
  assert.equal(matchesUserSearch(missing, "123"), false)
  assert.equal(matchesUserSearch(missing, "@"), false)
  assert.equal(matchesUserSearch(missing, "zs"), false)
})

test("同名成员不会按姓名合并，仍可用邮箱和手机号区分", () => {
  const members = [
    { id: "u1", email: "first@example.com", phone: "13800000001" },
    { id: "u2", email: "second@example.com", phone: "13800000002" },
  ].map((member) => ({
    id: member.id,
    index: createUserSearchIndex({
      name: "张三",
      nickname: "",
      displayName: "张三",
      email: member.email,
      phone: member.phone,
    }),
  }))
  assert.deepEqual(
    members.filter((member) => matchesUserSearch(member.index, "zs")).map((member) => member.id),
    ["u1", "u2"],
  )
  assert.deepEqual(
    members
      .filter((member) => matchesUserSearch(member.index, "second"))
      .map((member) => member.id),
    ["u2"],
  )
})
