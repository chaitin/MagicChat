import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"

import {
  collectDocumentImageFileIds,
  DocumentImage,
  transactionChangesDocumentImages,
} from "./document-image-extension"

describe("document image node", () => {
  it("collects unique persisted file IDs", () => {
    const nodes = [
      { attrs: { fileId: "file-1" }, type: { name: "documentImage" } },
      { attrs: { fileId: "file-2" }, type: { name: "paragraph" } },
      { attrs: { fileId: "file-1" }, type: { name: "documentImage" } },
      { attrs: { fileId: "file-3" }, type: { name: "documentImage" } },
    ]
    const document = {
      descendants: (
        callback: (node: (typeof nodes)[number]) => boolean | void
      ) => nodes.forEach((node) => callback(node)),
    } as unknown as ProseMirrorNode

    expect(collectDocumentImageFileIds(document)).toEqual(["file-1", "file-3"])
  })

  it("detects image insertion and upload attribute replacement", () => {
    const editor = new Editor({
      content: "<p>正文</p>",
      extensions: [StarterKit, DocumentImage],
    })
    const imageTransactions: boolean[] = []
    editor.on("transaction", ({ transaction }) => {
      imageTransactions.push(transactionChangesDocumentImages(transaction))
    })

    editor.commands.insertContent("补充")
    editor.commands.insertContent({
      attrs: { alt: "示例", externalUrl: null, fileId: null },
      type: DocumentImage.name,
    })
    const placeholder = findImageNode(editor.state.doc)
    expect(placeholder).not.toBeNull()
    if (!placeholder) throw new Error("image placeholder was not inserted")
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(placeholder.pos, undefined, {
        ...placeholder.node.attrs,
        fileId: "file-1",
      })
    )

    expect(imageTransactions).toEqual([false, true, true])
    expect(collectDocumentImageFileIds(editor.state.doc)).toEqual(["file-1"])
    editor.destroy()
  })
})

function findImageNode(
  document: ProseMirrorNode
): { node: ProseMirrorNode; pos: number } | null {
  let result: { node: ProseMirrorNode; pos: number } | null = null
  document.descendants((node, pos) => {
    if (node.type.name === DocumentImage.name) {
      result = { node, pos }
      return false
    }
  })
  return result
}
