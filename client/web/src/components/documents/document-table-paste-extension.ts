import { Extension } from "@tiptap/core"
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin } from "@tiptap/pm/state"
import {
  CellSelection,
  handlePaste as handleTablePaste,
  isInTable,
  selectionCell,
} from "@tiptap/pm/tables"

export const PreserveTableCellTypeOnPaste = Extension.create({
  name: "preserveTableCellTypeOnPaste",
  priority: 1_000,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handlePaste(view, event, slice) {
            if (!isInTable(view.state)) return false

            const selection = view.state.selection
            if (
              selection instanceof CellSelection &&
              selection.$anchorCell.pos !== selection.$headCell.pos
            ) {
              return false
            }

            const $targetCell =
              selection instanceof CellSelection
                ? selection.$anchorCell
                : selectionCell(view.state)
            const targetCell = $targetCell.nodeAfter
            if (!targetCell) return false

            const normalizedSlice = normalizeSingleCellType(
              slice,
              targetCell.type
            )
            return normalizedSlice
              ? handleTablePaste(view, event, normalizedSlice)
              : false
          },
        },
      }),
    ]
  },
})

function normalizeSingleCellType(
  slice: Slice,
  targetType: ProseMirrorNode["type"]
) {
  const cells = collectTableCells(slice.content)
  if (cells.length !== 1 || cells[0]?.type === targetType) return null

  return new Slice(
    mapTableCells(slice.content, (cell) =>
      targetType.create(cell.attrs, cell.content, cell.marks)
    ),
    slice.openStart,
    slice.openEnd
  )
}

function collectTableCells(fragment: Fragment) {
  const cells: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    if (isTableCell(node)) cells.push(node)
    else cells.push(...collectTableCells(node.content))
  })
  return cells
}

function mapTableCells(
  fragment: Fragment,
  mapCell: (cell: ProseMirrorNode) => ProseMirrorNode
): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach((node) => {
    if (isTableCell(node)) {
      nodes.push(mapCell(node))
      return
    }
    if (node.childCount > 0) {
      node = node.copy(mapTableCells(node.content, mapCell))
    }
    nodes.push(node)
  })
  return Fragment.from(nodes)
}

function isTableCell(node: ProseMirrorNode) {
  return (
    node.type.spec.tableRole === "cell" ||
    node.type.spec.tableRole === "header_cell"
  )
}
