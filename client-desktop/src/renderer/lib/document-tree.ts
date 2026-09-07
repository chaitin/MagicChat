import type { ClientDocument } from "@/lib/document-data-api"
import { createPinyinSearchText, normalizePinyinSearchQuery } from "@/lib/pinyin-search"

export const MAX_DOCUMENT_TREE_DEPTH = 64

export type DocumentTreeNode = Readonly<
  ClientDocument & { children: ReadonlyArray<DocumentTreeNode> }
>
export type DocumentDropTarget =
  | Readonly<{ folderId: string; kind: "folder" }>
  | Readonly<{ index: number; kind: "position"; parentId: string | null }>
export type DocumentLocation = Readonly<{ index: number; parentId: string | null }>

export function buildDocumentTree(
  documents: ReadonlyArray<ClientDocument>,
): ReadonlyArray<DocumentTreeNode> {
  const source = new Map<string, ClientDocument>()
  for (const document of documents) {
    if (source.has(document.id)) throw new Error("文档列表包含重复标识")
    source.set(document.id, document)
  }
  for (const document of documents) validateAncestors(document, source)

  const children = new Map<string | null, ClientDocument[]>()
  for (const document of documents) {
    if (document.parentId !== null) {
      const parent = source.get(document.parentId)
      if (!parent) throw new Error("文档列表包含孤立节点")
      if (parent.kind !== "folder") throw new Error("文档父节点必须是目录")
    }
    const siblings = children.get(document.parentId) ?? []
    siblings.push(document)
    children.set(document.parentId, siblings)
  }
  const materialize = (parentId: string | null): ReadonlyArray<DocumentTreeNode> =>
    Object.freeze(
      [...(children.get(parentId) ?? [])]
        .sort(compareDocuments)
        .map((document) => Object.freeze({ ...document, children: materialize(document.id) })),
    )
  return materialize(null)
}

export function filterDocumentTree(
  tree: ReadonlyArray<DocumentTreeNode>,
  keyword: string,
): ReadonlyArray<DocumentTreeNode> {
  const query = normalizePinyinSearchQuery(keyword)
  if (!query) return tree
  const filter = (nodes: ReadonlyArray<DocumentTreeNode>): ReadonlyArray<DocumentTreeNode> =>
    nodes.flatMap((node) => {
      const filteredChildren = filter(node.children)
      const matches = createPinyinSearchText([
        node.title,
        node.creator.name,
        node.updatedBy.name,
        node.kind === "folder" ? "目录" : "文档",
      ]).includes(query)
      if (!matches && filteredChildren.length === 0) return []
      return [Object.freeze({ ...node, children: Object.freeze(filteredChildren) })]
    })
  return Object.freeze(filter(tree))
}

export function findDocumentNode(
  tree: ReadonlyArray<DocumentTreeNode>,
  id: string,
): DocumentTreeNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node
    const child = findDocumentNode(node.children, id)
    if (child) return child
  }
  return undefined
}

export function collectDocumentNodeIds(node: DocumentTreeNode): ReadonlySet<string> {
  const ids = new Set<string>([node.id])
  for (const child of node.children) {
    for (const id of collectDocumentNodeIds(child)) ids.add(id)
  }
  return ids
}

export function collectFolderIds(tree: ReadonlyArray<DocumentTreeNode>): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const node of tree) {
    if (node.kind === "folder") ids.add(node.id)
    for (const id of collectFolderIds(node.children)) ids.add(id)
  }
  return ids
}

export function parseDocumentDropTarget(value: unknown): DocumentDropTarget | null {
  if (!value || typeof value !== "object") return null
  const input = value as Record<string, unknown>
  if (input.kind === "folder" && typeof input.folderId === "string") {
    return { folderId: input.folderId, kind: "folder" }
  }
  if (
    input.kind === "position" &&
    Number.isSafeInteger(input.index) &&
    (input.index as number) >= 0 &&
    (input.parentId === null || typeof input.parentId === "string")
  ) {
    return {
      index: input.index as number,
      kind: "position",
      parentId: input.parentId as string | null,
    }
  }
  return null
}

export function moveDocumentNode(
  tree: ReadonlyArray<DocumentTreeNode>,
  nodeId: string,
  target: DocumentDropTarget,
): ReadonlyArray<DocumentTreeNode> {
  const moving = findDocumentNode(tree, nodeId)
  if (!moving) return tree
  const blocked = collectDocumentNodeIds(moving)
  const parentId = target.kind === "folder" ? target.folderId : target.parentId
  if (parentId !== null && blocked.has(parentId)) return tree
  if (target.kind === "folder" && findDocumentNode(tree, target.folderId)?.kind !== "folder")
    return tree
  const parentDepth = parentId === null ? -1 : findDocumentDepth(tree, parentId)
  if (
    parentDepth === undefined ||
    parentDepth + 1 + getDocumentSubtreeHeight(moving) > MAX_DOCUMENT_TREE_DEPTH
  ) {
    return tree
  }

  const sourceLocation = flattenLocations(tree).get(nodeId)
  if (!sourceLocation) return tree
  const detached = removeNode(tree, nodeId)
  let index = target.kind === "folder" ? Number.MAX_SAFE_INTEGER : target.index
  if (
    target.kind === "position" &&
    sourceLocation.parentId === parentId &&
    sourceLocation.index < index
  ) {
    index -= 1
  }
  if (sourceLocation.parentId === parentId && sourceLocation.index === index) return tree
  const inserted = insertNode(detached, moving, parentId, index)
  return inserted ?? tree
}

export function flattenLocations(
  tree: ReadonlyArray<DocumentTreeNode>,
): ReadonlyMap<string, DocumentLocation> {
  const locations = new Map<string, DocumentLocation>()
  const visit = (nodes: ReadonlyArray<DocumentTreeNode>, parentId: string | null) => {
    nodes.forEach((node, index) => {
      locations.set(node.id, Object.freeze({ index, parentId }))
      visit(node.children, node.id)
    })
  }
  visit(tree, null)
  return locations
}

function validateAncestors(document: ClientDocument, source: ReadonlyMap<string, ClientDocument>) {
  const visited = new Set([document.id])
  let parentId = document.parentId
  let depth = 0
  while (parentId !== null) {
    if (visited.has(parentId)) throw new Error("文档列表包含循环层级")
    visited.add(parentId)
    const parent = source.get(parentId)
    if (!parent) throw new Error("文档列表包含孤立节点")
    if (parent.kind !== "folder") throw new Error("文档父节点必须是目录")
    parentId = parent.parentId
    depth += 1
    if (depth > MAX_DOCUMENT_TREE_DEPTH) throw new Error("文档目录层级超过限制")
  }
}

function compareDocuments(left: ClientDocument, right: ClientDocument): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

function removeNode(
  nodes: ReadonlyArray<DocumentTreeNode>,
  id: string,
): ReadonlyArray<DocumentTreeNode> {
  return nodes.flatMap((node) => {
    if (node.id === id) return []
    const children = removeNode(node.children, id)
    return [
      children === node.children
        ? node
        : Object.freeze({ ...node, children: Object.freeze(children) }),
    ]
  })
}

function insertNode(
  nodes: ReadonlyArray<DocumentTreeNode>,
  moving: DocumentTreeNode,
  parentId: string | null,
  index: number,
): ReadonlyArray<DocumentTreeNode> | null {
  if (parentId === null) {
    const next = [...nodes]
    next.splice(Math.min(index, next.length), 0, moving)
    return Object.freeze(next)
  }
  let inserted = false
  const next = nodes.map((node) => {
    if (node.id === parentId && node.kind === "folder") {
      const children = [...node.children]
      children.splice(Math.min(index, children.length), 0, moving)
      inserted = true
      return Object.freeze({ ...node, children: Object.freeze(children) })
    }
    const children = insertNode(node.children, moving, parentId, index)
    if (children) {
      inserted = true
      return Object.freeze({ ...node, children })
    }
    return node
  })
  return inserted ? Object.freeze(next) : null
}

function findDocumentDepth(
  nodes: ReadonlyArray<DocumentTreeNode>,
  id: string,
  depth = 0,
): number | undefined {
  for (const node of nodes) {
    if (node.id === id) return depth
    const childDepth = findDocumentDepth(node.children, id, depth + 1)
    if (childDepth !== undefined) return childDepth
  }
  return undefined
}

function getDocumentSubtreeHeight(node: DocumentTreeNode): number {
  let height = 0
  for (const child of node.children) {
    height = Math.max(height, 1 + getDocumentSubtreeHeight(child))
  }
  return height
}
