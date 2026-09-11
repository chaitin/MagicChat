import { describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"

import { DocumentHorizontalRule } from "./document-horizontal-rule-extension"

describe("document horizontal rule", () => {
  it("persists thickness and line style attributes", () => {
    const editor = new Editor({
      content: "<p>正文</p>",
      extensions: [
        StarterKit.configure({ horizontalRule: false }),
        DocumentHorizontalRule,
      ],
    })

    expect(editor.commands.setHorizontalRule()).toBe(true)
    const horizontalRule = findHorizontalRule(editor.state.doc)
    expect(horizontalRule?.node.attrs).toMatchObject({
      lineStyle: "solid",
      thickness: 1,
    })
    if (!horizontalRule) throw new Error("horizontal rule was not inserted")

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(horizontalRule.pos, undefined, {
        ...horizontalRule.node.attrs,
        lineStyle: "dashed",
        thickness: 4,
      })
    )

    expect(findHorizontalRule(editor.state.doc)?.node.attrs).toMatchObject({
      lineStyle: "dashed",
      thickness: 4,
    })
    editor.destroy()
  })
})

function findHorizontalRule(
  document: ProseMirrorNode
): { node: ProseMirrorNode; pos: number } | null {
  let result: { node: ProseMirrorNode; pos: number } | null = null
  document.descendants((node, pos) => {
    if (node.type.name === DocumentHorizontalRule.name) {
      result = { node, pos }
      return false
    }
  })
  return result
}
