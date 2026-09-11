import { mergeAttributes, Node as TiptapNode } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { Transaction } from "@tiptap/pm/state"
import { ReactNodeViewRenderer } from "@tiptap/react"

import { DocumentImageNodeView } from "@/components/documents/document-image-node"

export const DocumentImage = TiptapNode.create({
  name: "documentImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      alignment: {
        default: "center",
        parseHTML: (element) =>
          element.getAttribute("data-alignment") ?? "center",
        renderHTML: (attributes) => ({
          "data-alignment": attributes.alignment,
        }),
      },
      alt: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-alt") ?? "",
        renderHTML: (attributes) => ({ "data-alt": attributes.alt }),
      },
      externalUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-external-url"),
        renderHTML: (attributes) => ({
          "data-external-url": attributes.externalUrl,
        }),
      },
      fileId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-id"),
        renderHTML: (attributes) => ({ "data-file-id": attributes.fileId }),
      },
      width: {
        default: 100,
        parseHTML: (element) =>
          Number(element.getAttribute("data-width")) || 100,
        renderHTML: (attributes) => ({ "data-width": attributes.width }),
      },
    }
  },

  parseHTML() {
    return [{ tag: "figure[data-document-image]" }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-document-image": "" }),
      ["span", {}, "文档图片"],
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentImageNodeView)
  },
})

export function transactionChangesDocumentImages(
  transaction: Transaction
): boolean {
  for (const [index, step] of transaction.steps.entries()) {
    const before = transaction.docs[index]
    const after = transaction.docs[index + 1] ?? transaction.doc
    if (!before || !after) return true
    let changesImages = false
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      changesImages ||=
        documentRangeContainsImage(before, oldStart, oldEnd) ||
        documentRangeContainsImage(after, newStart, newEnd)
    })
    if (changesImages) return true
  }
  return false
}

export function collectDocumentImageFileIds(
  document: ProseMirrorNode
): string[] {
  const fileIds = new Set<string>()
  document.descendants((node) => {
    if (node.type.name !== DocumentImage.name) return
    const fileId = node.attrs.fileId
    if (typeof fileId === "string" && fileId) fileIds.add(fileId)
  })
  return Array.from(fileIds)
}

function documentRangeContainsImage(
  document: ProseMirrorNode,
  from: number,
  to: number
) {
  let containsImage = false
  document.nodesBetween(from, to, (node) => {
    if (node.type.name === DocumentImage.name) {
      containsImage = true
      return false
    }
  })
  return containsImage
}
