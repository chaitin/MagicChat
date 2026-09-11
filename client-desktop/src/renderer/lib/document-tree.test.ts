import { describe, expect, it } from "vitest"

import type { ClientDocument } from "./document-data-api"
import {
  buildDocumentTree,
  filterDocumentTree,
  flattenLocations,
  moveDocumentNode,
  parseDocumentDropTarget,
} from "./document-tree"

function node(
  id: string,
  kind: "document" | "folder" = "document",
  parentId: string | null = null,
  sortOrder = 0,
  title = id,
): ClientDocument {
  const user = { avatar: "", id: "user-1", name: "用户", nickname: "" }
  return {
    contributorCount: 1,
    contributors: [{ avatar: "", id: "user-1", name: "测试用户", nickname: "" }],
    createdAt: "2026-08-04T09:00:00Z",
    creator: user,
    documentType: kind === "document" ? "document" : null,
    id,
    kind,
    parentId,
    projectId: "project-1",
    schemaVersion: 1,
    sortOrder,
    title,
    updatedAt: "2026-08-04T09:00:00Z",
    updatedBy: user,
  }
}

describe("document tree", () => {
  it("按 Server 排序构建不可变树", () => {
    const tree = buildDocumentTree([
      node("second", "document", "folder", 1),
      node("folder", "folder"),
      node("first", "document", "folder", 0),
    ])
    expect(tree[0]?.children.map((item) => item.id)).toEqual(["first", "second"])
    expect(Object.isFrozen(tree)).toBe(true)
  })

  it.each([
    ["孤儿", [node("child", "document", "missing")]],
    ["重复", [node("same"), node("same")]],
    ["循环", [node("one", "folder", "two"), node("two", "folder", "one")]],
    ["非目录父节点", [node("parent"), node("child", "document", "parent")]],
  ])("拒绝%s结构", (_label, documents) => {
    expect(() => buildDocumentTree(documents)).toThrow()
  })

  it("拒绝超过 64 层", () => {
    const documents = Array.from({ length: 66 }, (_, index) =>
      node(`folder-${index}`, "folder", index === 0 ? null : `folder-${index - 1}`),
    )
    expect(() => buildDocumentTree(documents)).toThrow("层级超过限制")
  })

  it("过滤时忽略大小写并保留 Unicode 匹配祖先", () => {
    const tree = buildDocumentTree([
      node("folder", "folder", null, 0, "Product"),
      node("child", "document", "folder", 0, "设计说明"),
      node("other", "document", null, 1, "Meeting"),
    ])
    const unicode = filterDocumentTree(tree, "设计")
    expect(unicode.map((item) => item.id)).toEqual(["folder"])
    expect(unicode[0]?.children[0]?.id).toBe("child")
    expect(filterDocumentTree(tree, "meeting")[0]?.id).toBe("other")
    expect(filterDocumentTree(tree, "   ")).toBe(tree)
    expect(filterDocumentTree(tree, "sjsm")[0]?.children[0]?.id).toBe("child")
    expect(filterDocumentTree(tree, "shejishuoming")[0]?.children[0]?.id).toBe("child")
    expect(filterDocumentTree(tree, "文档")).toEqual([])
    expect(filterDocumentTree(tree, "目录")).toEqual([])
    expect(filterDocumentTree(tree, "wd")).toEqual([])
    expect(filterDocumentTree(tree, "用户")).toEqual([])
  })

  it("解析拖动目标并拒绝循环移动", () => {
    const tree = buildDocumentTree([
      node("root", "folder"),
      node("child", "folder", "root"),
      node("document", "document", "child"),
    ])
    expect(parseDocumentDropTarget({ kind: "position", parentId: null, index: 0 })).toEqual({
      index: 0,
      kind: "position",
      parentId: null,
    })
    expect(moveDocumentNode(tree, "root", { folderId: "child", kind: "folder" })).toBe(tree)
  })

  it("投影同层与跨目录位置", () => {
    const tree = buildDocumentTree([
      node("folder", "folder"),
      node("one", "document", null, 1),
      node("two", "document", null, 2),
    ])
    const moved = moveDocumentNode(tree, "two", { folderId: "folder", kind: "folder" })
    expect(flattenLocations(moved).get("two")).toEqual({ index: 0, parentId: "folder" })
  })

  it("移动子树时拒绝超过 64 层，并允许恰好位于深度边界", () => {
    const destination = Array.from({ length: 64 }, (_, index) =>
      node(`destination-${index}`, "folder", index === 0 ? null : `destination-${index - 1}`),
    )
    const tree = buildDocumentTree([
      ...destination,
      node("moving", "folder"),
      node("moving-child", "document", "moving"),
    ])

    expect(moveDocumentNode(tree, "moving", { folderId: "destination-63", kind: "folder" })).toBe(
      tree,
    )

    const boundary = moveDocumentNode(tree, "moving", {
      folderId: "destination-62",
      kind: "folder",
    })
    expect(boundary).not.toBe(tree)
    expect(flattenLocations(boundary).get("moving")).toEqual({
      index: 1,
      parentId: "destination-62",
    })
  })

  it("同层向下移动时修正删除源节点造成的索引偏移", () => {
    const tree = buildDocumentTree([
      node("a", "document", null, 0),
      node("b", "document", null, 1),
      node("c", "document", null, 2),
    ])

    const moved = moveDocumentNode(tree, "a", { index: 2, kind: "position", parentId: null })

    expect(moved.map((item) => item.id)).toEqual(["b", "a", "c"])
    expect(flattenLocations(moved).get("a")).toEqual({ index: 1, parentId: null })
  })
})
