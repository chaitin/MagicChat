import assert from "node:assert/strict"
import test from "node:test"
import { buildOrganizationDirectoryTree } from "../../shared/organization-directory.ts"

const snapshot = {
  units: [
    { id: "group", parent_id: null, name: "集团", kind: "group", member_count: 10 },
    { id: "company", parent_id: "group", name: "子公司", kind: "company", member_count: 0 },
  ],
  departments: [
    { id: "root", unit_id: "group", parent_id: null, name: "集团", is_root: true, member_count: 10 },
    { id: "parent", unit_id: "group", parent_id: "root", name: "研发", is_root: false, member_count: 5 },
    { id: "child", unit_id: "group", parent_id: "parent", name: "平台", is_root: false, member_count: 2 },
    { id: "legacy", unit_id: "group", parent_id: "root", name: "旧节点", is_root: false },
    { id: "company-root", unit_id: "company", parent_id: null, name: "子公司", is_root: true, member_count: 0 },
  ],
}

function flatten(nodes: ReturnType<typeof buildOrganizationDirectoryTree>): ReturnType<typeof buildOrganizationDirectoryTree> {
  return nodes.flatMap(node => [node, ...flatten(node.children)])
}

test("节点保留快照人数，零人数与缺失字段不同", () => {
  const nodes = flatten(buildOrganizationDirectoryTree(snapshot))
  const count = (name: string) => nodes.find(node => node.name === name)?.memberCount
  assert.equal(count("集团"), 10)
  assert.equal(count("子公司"), 0)
  assert.equal(count("研发"), 5)
  assert.equal(count("平台"), 2)
  assert.equal(count("旧节点"), undefined)
})

test("搜索过滤不重新计算祖先或匹配节点的人数", () => {
  const nodes = flatten(buildOrganizationDirectoryTree(snapshot, "平台"))
  assert.equal(nodes.find(node => node.name === "集团")?.memberCount, 10)
  assert.equal(nodes.find(node => node.name === "研发")?.memberCount, 5)
  assert.equal(nodes.find(node => node.name === "平台")?.memberCount, 2)
})
