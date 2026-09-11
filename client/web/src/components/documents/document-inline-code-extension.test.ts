import { Editor } from "@tiptap/core"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { afterEach, describe, expect, it } from "vitest"

import { DocumentStarterKit } from "@/components/documents/document-inline-code-extension"

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe("DocumentInlineCode", () => {
  it("allows text color to coexist with inline code", () => {
    editor = new Editor({
      content: "<p><code>inline</code></p>",
      extensions: [DocumentStarterKit, TextStyle, Color],
    })

    editor
      .chain()
      .setTextSelection({ from: 1, to: 7 })
      .setColor("#2563eb")
      .run()

    const textNode = editor.state.doc.nodeAt(1)
    expect(textNode?.marks.map((mark) => mark.type.name).sort()).toEqual([
      "code",
      "textStyle",
    ])
    expect(editor.getHTML()).toContain("<code>")
    expect(editor.getHTML()).toContain("color: rgb(37, 99, 235)")
  })
})
