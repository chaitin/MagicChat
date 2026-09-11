import Collaboration from "@tiptap/extension-collaboration"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"

import { DocumentBlockBackground } from "@/components/documents/document-block-background-extension"

const backgroundColor = "oklch(93.6% 0.032 17.717)"

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe("DocumentBlockBackground", () => {
  it("renders a saved paragraph background across the block node", () => {
    editor = new Editor({
      content: "<p>段落正文</p>",
      extensions: [
        StarterKit,
        DocumentBlockBackground.configure({ allowedColors: [backgroundColor] }),
      ],
    })

    const paragraph = editor.state.doc.nodeAt(0)
    expect(paragraph?.type.name).toBe("paragraph")
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...paragraph?.attrs,
        blockBackgroundColor: backgroundColor,
      })
    )

    expect(editor.state.doc.nodeAt(0)?.attrs.blockBackgroundColor).toBe(
      backgroundColor
    )
    expect(editor.getHTML()).toContain(
      `data-block-background-color="${backgroundColor}"`
    )
    expect(editor.getHTML()).toContain(
      "background-color: oklch(0.936 0.032 17.717)"
    )
  })

  it("preserves the paragraph background with collaboration enabled", () => {
    const collaborationDocument = new Y.Doc()
    editor = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        Collaboration.configure({
          fragment: collaborationDocument.getXmlFragment("body"),
        }),
        DocumentBlockBackground.configure({
          allowedColors: [backgroundColor],
        }),
      ],
    })

    const paragraph = editor.state.doc.nodeAt(0)
    expect(paragraph?.type.name).toBe("paragraph")
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...paragraph?.attrs,
        blockBackgroundColor: backgroundColor,
      })
    )

    expect(editor.state.doc.nodeAt(0)?.attrs.blockBackgroundColor).toBe(
      backgroundColor
    )
    expect(editor.getHTML()).toContain("data-block-background-color")
    collaborationDocument.destroy()
  })

  it("does not render an unapproved background value", () => {
    editor = new Editor({
      content: "<p>段落正文</p>",
      extensions: [
        StarterKit,
        DocumentBlockBackground.configure({ allowedColors: [backgroundColor] }),
      ],
    })
    const paragraph = editor.state.doc.nodeAt(0)
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(0, undefined, {
        ...paragraph?.attrs,
        blockBackgroundColor: "red; position: fixed",
      })
    )

    expect(editor.getHTML()).not.toContain("position: fixed")
    expect(editor.getHTML()).not.toContain("data-block-background-color")
  })
})
