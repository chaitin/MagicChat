export type ProjectDocumentType =
  "document" | "file" | "markdown" | "mindmap" | "spreadsheet"

type ProjectDocumentCreator = {
  id: string
  name: string
}

type ProjectDocumentNodeBase = {
  creator: ProjectDocumentCreator
  id: string
  name: string
  updatedAt: string
  updatedBy: ProjectDocumentCreator
}

export type ProjectDocumentFile = ProjectDocumentNodeBase & {
  kind: "document"
  type: ProjectDocumentType
}

export type ProjectDocumentFolder = ProjectDocumentNodeBase & {
  children: ProjectDocumentNode[]
  kind: "folder"
}

export type ProjectDocumentNode = ProjectDocumentFile | ProjectDocumentFolder

export const initialDocumentTree: ProjectDocumentNode[] = [
  {
    children: [
      {
        creator: { id: "user-1", name: "林晓" },
        id: "document-1",
        kind: "document",
        name: "产品需求文档",
        type: "document",
        updatedAt: "2026-07-21 16:42",
        updatedBy: { id: "user-2", name: "陈默" },
      },
      {
        creator: { id: "user-1", name: "林晓" },
        id: "document-4",
        kind: "document",
        name: "视觉设计规范",
        type: "file",
        updatedAt: "2026-07-18 15:07",
        updatedBy: { id: "user-1", name: "林晓" },
      },
    ],
    creator: { id: "user-1", name: "林晓" },
    id: "folder-product",
    kind: "folder",
    name: "产品资料",
    updatedAt: "2026-07-21 16:42",
    updatedBy: { id: "user-2", name: "陈默" },
  },
  {
    children: [
      {
        creator: { id: "user-2", name: "陈默" },
        id: "document-2",
        kind: "document",
        name: "API 接入说明",
        type: "markdown",
        updatedAt: "2026-07-20 18:15",
        updatedBy: { id: "user-3", name: "顾然" },
      },
      {
        children: [
          {
            creator: { id: "user-3", name: "顾然" },
            id: "document-6",
            kind: "document",
            name: "消息分区设计",
            type: "mindmap",
            updatedAt: "2026-07-19 14:25",
            updatedBy: { id: "user-1", name: "林晓" },
          },
        ],
        creator: { id: "user-3", name: "顾然" },
        id: "folder-technical",
        kind: "folder",
        name: "技术方案",
        updatedAt: "2026-07-19 14:25",
        updatedBy: { id: "user-1", name: "林晓" },
      },
    ],
    creator: { id: "user-2", name: "陈默" },
    id: "folder-development",
    kind: "folder",
    name: "开发文档",
    updatedAt: "2026-07-20 18:15",
    updatedBy: { id: "user-3", name: "顾然" },
  },
  {
    creator: { id: "user-3", name: "顾然" },
    id: "document-3",
    kind: "document",
    name: "项目排期与里程碑",
    type: "spreadsheet",
    updatedAt: "2026-07-19 11:36",
    updatedBy: { id: "user-2", name: "陈默" },
  },
  {
    creator: { id: "user-2", name: "陈默" },
    id: "document-5",
    kind: "document",
    name: "项目会议纪要",
    type: "document",
    updatedAt: "2026-07-17 17:28",
    updatedBy: { id: "user-2", name: "陈默" },
  },
]

export function findPrototypeDocumentNode(
  nodeId: string,
  tree: ProjectDocumentNode[] = initialDocumentTree
): ProjectDocumentNode | null {
  for (const node of tree) {
    if (node.id === nodeId) return node
    if (node.kind === "folder") {
      const match = findPrototypeDocumentNode(nodeId, node.children)
      if (match) return match
    }
  }
  return null
}

export function getPrototypeDocumentPath(document: ProjectDocumentFile) {
  if (document.type !== "document" && document.type !== "markdown") return null
  return `/documents/${document.type}/${encodeURIComponent(document.id)}`
}
