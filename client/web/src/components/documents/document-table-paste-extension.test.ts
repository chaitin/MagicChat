import { afterEach, describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { TableKit } from "@tiptap/extension-table"
import { TextSelection } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { PreserveTableCellTypeOnPaste } from "@/components/documents/document-table-paste-extension"

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe("PreserveTableCellTypeOnPaste", () => {
  it("keeps a body target as td when clipboard data contains th", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit, PreserveTableCellTypeOnPaste, TableKit],
      content: {
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              tableRow("tableHeader", "header"),
              tableRow("tableCell", "body"),
            ],
          },
        ],
      },
    })

    const cells = tableCells(editor)
    const source = cells.find((cell) => cell.text === "header")
    const target = cells.find((cell) => cell.text === "body")
    expect(source?.type).toBe("tableHeader")
    expect(target?.type).toBe("tableCell")

    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(source!.pos))
      )
    )
    const slice = editor.state.selection.content()

    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, target!.pos + 2)
      )
    )
    const handled = editor.view.someProp("handlePaste", (handlePaste) =>
      handlePaste(editor!.view, new Event("paste") as ClipboardEvent, slice)
    )

    expect(handled).toBe(true)
    expect(tableCells(editor).find((cell) => cell.text === "header" && cell.pos > source!.pos)?.type).toBe(
      "tableCell"
    )
  })
})

function tableRow(cellType: "tableCell" | "tableHeader", text: string) {
  return {
    type: "tableRow",
    content: [
      {
        type: cellType,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text }],
          },
        ],
      },
    ],
  }
}

function tableCells(currentEditor: Editor) {
  const cells: Array<{ pos: number; text: string; type: string }> = []
  currentEditor.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
      cells.push({ pos, text: node.textContent, type: node.type.name })
    }
  })
  return cells
}
