import * as React from "react"
import { Extension } from "@tiptap/core"
import Collaboration from "@tiptap/extension-collaboration"
import CollaborationCaret from "@tiptap/extension-collaboration-caret"
import { DragHandle } from "@tiptap/extension-drag-handle-react"
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import TaskList from "@tiptap/extension-task-list"
import { TableKit } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { CellSelection } from "@tiptap/pm/tables"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import { toast } from "sonner"
import type * as Y from "yjs"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paintbrush,
  PaintRoller,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react"

import {
  DocumentBlockBackground,
  documentBlockBackgroundTypes,
} from "@/components/documents/document-block-background-extension"
import { DocumentControlSeparator } from "@/components/documents/document-control-separator"
import { DocumentHorizontalRule } from "@/components/documents/document-horizontal-rule-extension"
import { DocumentImage } from "@/components/documents/document-image-extension"
import { DocumentImageResolutionContext } from "@/components/documents/document-image-resolution"
import { DocumentStarterKit } from "@/components/documents/document-inline-code-extension"
import { DocumentTableInsertMenu } from "@/components/documents/document-table-insert-menu"
import { DocumentTaskItem } from "@/components/documents/document-task-item-extension"
import { PreserveTableCellTypeOnPaste } from "@/components/documents/document-table-paste-extension"
import { sanitizeDocumentPasteHTML } from "@/components/documents/document-paste-sanitizer"
import { useDocumentImageResolutions } from "@/components/documents/use-document-image-resolutions"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  safePresenceColor,
  type DocumentPresenceUser,
} from "@/lib/document-presence"
import { cn } from "@/lib/utils"

import "./document-editor.css"

const activeTableCellPluginKey = new PluginKey("activeTableCell")
const activeBlockPluginKey = new PluginKey<number | null>("activeBlock")

const DocumentDecorations = Extension.create({
  name: "documentDecorations",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: activeTableCellPluginKey,
        props: {
          decorations(state) {
            const selection = state.selection
            if (selection instanceof CellSelection) {
              return DecorationSet.empty
            }
            const $anchor = selection.$anchor
            for (let depth = $anchor.depth; depth > 0; depth -= 1) {
              const node = $anchor.node(depth)
              if (
                node.type.name !== "tableCell" &&
                node.type.name !== "tableHeader"
              ) {
                continue
              }
              const from = $anchor.before(depth)
              return DecorationSet.create(state.doc, [
                Decoration.node(from, from + node.nodeSize, {
                  class: "document-table-active-cell",
                }),
              ])
            }
            return DecorationSet.empty
          },
        },
      }),
      new Plugin<number | null>({
        key: activeBlockPluginKey,
        state: {
          init: () => null,
          apply(transaction, activeBlockPos) {
            const nextActiveBlockPos = transaction.getMeta(
              activeBlockPluginKey
            ) as number | null | undefined
            if (nextActiveBlockPos !== undefined) return nextActiveBlockPos
            if (activeBlockPos === null) return null

            const mapped = transaction.mapping.mapResult(activeBlockPos)
            return mapped.deleted ? null : mapped.pos
          },
        },
        props: {
          decorations(state) {
            const pos = activeBlockPluginKey.getState(state)
            if (pos === null || pos === undefined) return DecorationSet.empty
            const node = state.doc.nodeAt(pos)
            if (!node) return DecorationSet.empty
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, {
                class: "document-block-active",
              }),
            ])
          },
        },
      }),
    ]
  },
})

export function DocumentEditor({
  collaborationDocument,
  collaborationProvider,
  collaborationUser,
  onTitleBlur,
  onTitleChange,
  title,
}: {
  collaborationDocument: Y.Doc
  collaborationProvider: HocuspocusProvider
  collaborationUser: DocumentPresenceUser
  onTitleBlur?: () => void
  onTitleChange: (title: string) => void
  title: string
}) {
  const editor = useEditor(
    {
      editorProps: {
        attributes: {
          "aria-label": "文档正文",
          class: "document-editor-content",
        },
        transformPastedHTML: sanitizeDocumentPasteHTML,
      },
      extensions: [
        DocumentStarterKit.configure({
          heading: { levels: [1, 2, 3] },
          horizontalRule: false,
          link: { openOnClick: false },
          undoRedo: false,
        }),
        Collaboration.configure({
          fragment: collaborationDocument.getXmlFragment("body"),
        }),
        CollaborationCaret.configure({
          provider: collaborationProvider,
          render: renderCollaborationCaret,
          selectionRender: renderCollaborationSelection,
          user: collaborationUser,
        }),
        DocumentHorizontalRule,
        DocumentImage,
        Highlight.configure({ multicolor: true }),
        DocumentBlockBackground.configure({
          allowedColors: documentColors.map((color) => color.value),
        }),
        TextStyle,
        Color,
        TextAlign.configure({
          alignments: ["left", "center", "right"],
          types: ["heading", "paragraph"],
        }),
        TaskList,
        DocumentTaskItem,
        PreserveTableCellTypeOnPaste,
        TableKit.configure({ table: { resizable: true } }),
        DocumentDecorations,
        Placeholder.configure({
          placeholder: "开始撰写文档…",
        }),
      ],
      shouldRerenderOnTransaction: true,
    },
    [
      collaborationDocument,
      collaborationProvider,
      collaborationUser,
      DocumentDecorations,
      PreserveTableCellTypeOnPaste,
    ]
  )

  const imageResolutions = useDocumentImageResolutions(editor)
  const [editorContainer, setEditorContainer] =
    React.useState<HTMLDivElement | null>(null)

  if (!editor) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DocumentToolbar editor={editor} />
      <div className="document-workspace-canvas min-h-0 flex-1 overflow-y-auto p-4">
        <div
          className="document-editor mx-auto min-h-full max-w-4xl border bg-background px-8 py-12 shadow-md sm:px-14 sm:py-16"
          ref={setEditorContainer}
        >
          <input
            aria-label="文档页面标题"
            className="mb-8 w-full border-b bg-transparent pb-5 text-4xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60"
            onBlur={onTitleBlur}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="无标题文档"
            value={title}
          />
          <DocumentImageResolutionContext.Provider value={imageResolutions}>
            <EditorContent editor={editor} />
          </DocumentImageResolutionContext.Provider>
          <DocumentBlockHandle editor={editor} />
          <DocumentTableMenu container={editorContainer} editor={editor} />
        </div>
      </div>
    </div>
  )
}

function renderCollaborationCaret(user: Record<string, unknown>) {
  const color = safePresenceColor(user.color)
  const cursor = document.createElement("span")
  cursor.className = "collaboration-carets__caret"
  cursor.style.borderColor = color

  const label = document.createElement("span")
  label.className = "collaboration-carets__label"
  label.style.backgroundColor = color
  label.textContent = typeof user.name === "string" ? user.name : "协作者"
  cursor.append(label)
  return cursor
}

function renderCollaborationSelection(user: Record<string, unknown>) {
  const color = safePresenceColor(user.color)
  return {
    class: "collaboration-carets__selection",
    nodeName: "span",
    style: `background-color: ${color}38`,
  }
}

const blockHandleButtonClassName =
  "cursor-grab bg-transparent text-muted-foreground/60 shadow-none hover:bg-secondary hover:text-foreground active:cursor-grabbing aria-expanded:bg-secondary aria-expanded:text-foreground"

function DocumentBlockHandle({ editor }: { editor: Editor }) {
  const [handleHovered, setHandleHovered] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [activeBlock, setActiveBlock] = React.useState<{
    nodeSize: number
    pos: number
  } | null>(null)

  const handleNodeChange = React.useCallback(
    ({ node, pos }: { node: { nodeSize: number } | null; pos: number }) => {
      if (node) setActiveBlock({ nodeSize: node.nodeSize, pos })
    },
    []
  )

  React.useLayoutEffect(() => {
    const highlighted = handleHovered || menuOpen
    const nextActiveBlockPos =
      highlighted && activeBlock ? activeBlock.pos : null
    if (activeBlockPluginKey.getState(editor.state) === nextActiveBlockPos)
      return

    editor.view.dispatch(
      editor.state.tr.setMeta(activeBlockPluginKey, nextActiveBlockPos)
    )
  }, [activeBlock, editor, handleHovered, menuOpen])

  function handleMenuOpenChange(open: boolean) {
    setMenuOpen(open)
    editor.commands.setMeta("lockDragHandle", open)
  }

  function insertParagraph(position: "after" | "before") {
    if (!activeBlock) return
    const paragraph = editor.schema.nodes.paragraph
    if (!paragraph) return

    const insertPos =
      position === "before"
        ? activeBlock.pos
        : activeBlock.pos + activeBlock.nodeSize
    editor.view.dispatch(
      editor.state.tr.insert(insertPos, paragraph.create()).scrollIntoView()
    )
    editor.commands.focus(insertPos + 1)
  }

  function setBlockTextColor(color: string | null) {
    if (!activeBlock) return
    const chain = editor.chain().focus().setNodeSelection(activeBlock.pos)
    if (color) chain.setColor(color).run()
    else chain.unsetColor().run()
  }

  function setBlockBackgroundColor(color: string | null) {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node || !documentBlockBackgroundTypes.includes(node.type.name)) return

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(activeBlock.pos, undefined, {
        ...node.attrs,
        blockBackgroundColor: color,
      })
    )
    editor.commands.focus()
  }

  function deleteBlock() {
    if (!activeBlock) return
    editor
      .chain()
      .focus()
      .setNodeSelection(activeBlock.pos)
      .deleteSelection()
      .run()
  }

  function transformBlock(format: BlockFormat) {
    if (!activeBlock) return
    const node = editor.state.doc.nodeAt(activeBlock.pos)
    if (!node) return

    let selectionPos = activeBlock.pos + 1
    let selectionNode = node
    while (!selectionNode.isTextblock && selectionNode.firstChild) {
      selectionNode = selectionNode.firstChild
      selectionPos += 1
    }
    editor.commands.setTextSelection(selectionPos)

    if (editor.isActive("bulletList")) {
      editor.chain().focus().toggleBulletList().run()
    }
    if (editor.isActive("orderedList")) {
      editor.chain().focus().toggleOrderedList().run()
    }
    if (editor.isActive("taskList")) {
      editor.chain().focus().toggleTaskList().run()
    }
    if (editor.isActive("blockquote")) {
      editor.chain().focus().toggleBlockquote().run()
    }
    if (editor.isActive("codeBlock")) {
      editor.chain().focus().toggleCodeBlock().run()
    }

    editor.chain().focus().setParagraph().run()

    switch (format) {
      case "paragraph":
        return
      case "heading-1":
        editor.chain().focus().setHeading({ level: 1 }).run()
        return
      case "heading-2":
        editor.chain().focus().setHeading({ level: 2 }).run()
        return
      case "heading-3":
        editor.chain().focus().setHeading({ level: 3 }).run()
        return
      case "bullet-list":
        editor.chain().focus().toggleBulletList().run()
        return
      case "ordered-list":
        editor.chain().focus().toggleOrderedList().run()
        return
      case "task-list":
        editor.chain().focus().toggleTaskList().run()
        return
      case "blockquote":
        editor.chain().focus().toggleBlockquote().run()
        return
      case "code-block":
        editor.chain().focus().toggleCodeBlock().run()
    }
  }

  return (
    <DragHandle
      className="document-block-handle"
      editor={editor}
      onNodeChange={handleNodeChange}
    >
      <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="块操作"
            className={blockHandleButtonClassName}
            onMouseEnter={() => setHandleHovered(true)}
            onMouseLeave={() => setHandleHovered(false)}
            size="icon-xs"
            title="点击打开菜单，拖动调整位置"
            type="button"
            variant="secondary"
          >
            <GripVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44" side="left">
          <DropdownMenuItem onSelect={() => insertParagraph("before")}>
            <ArrowUp />
            在上方插入一行
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => insertParagraph("after")}>
            <ArrowDown />
            在下方插入一行
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowLeftRight />
              格式转换
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuItem onSelect={() => transformBlock("paragraph")}>
                <Pilcrow />
                正文
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-1")}>
                <Heading1 />
                一级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-2")}>
                <Heading2 />
                二级标题
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("heading-3")}>
                <Heading3 />
                三级标题
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => transformBlock("bullet-list")}>
                <List />
                无序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("ordered-list")}>
                <ListOrdered />
                有序列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("task-list")}>
                <ListTodo />
                待办列表
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("blockquote")}>
                <Quote />
                引用
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => transformBlock("code-block")}>
                <Code />
                代码块
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Paintbrush />
              段落背景
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto">
              <DocumentColorPaletteItems
                label="段落背景"
                onColorSelect={setBlockBackgroundColor}
                resetLabel="无段落背景"
                resetSwatchClassName="bg-background"
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Baseline />
              文字颜色
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-auto">
              <DocumentColorPaletteItems
                label="文字颜色"
                onColorSelect={setBlockTextColor}
                resetLabel="默认颜色"
                resetSwatchClassName="bg-foreground"
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={deleteBlock} variant="destructive">
            <Trash2 />
            删除块
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DragHandle>
  )
}

type TableMenuKind = "row" | "column"

function useTableMenu(editor: Editor, container: HTMLDivElement | null) {
  const [hoveredCell, setHoveredCell] = React.useState<{
    cell: HTMLElement
    row: HTMLElement
  } | null>(null)
  const [openMenu, setOpenMenu] = React.useState<TableMenuKind | null>(null)
  const [, updatePosition] = React.useReducer((value) => value + 1, 0)

  React.useLayoutEffect(() => {
    if (!container) return

    const handleMouseMove = (event: MouseEvent) => {
      if (openMenu || !(event.target instanceof HTMLElement)) return
      if (event.target.closest(".document-table-handle")) return

      const cell = event.target.closest<HTMLElement>("td, th")
      if (!cell || !editor.view.dom.contains(cell)) {
        setHoveredCell(null)
        return
      }
      const row = cell.closest<HTMLElement>("tr")
      if (row) setHoveredCell({ cell, row })
    }
    const handleMouseLeave = () => {
      if (!openMenu) setHoveredCell(null)
    }

    container.addEventListener("mousemove", handleMouseMove)
    container.addEventListener("mouseleave", handleMouseLeave)
    container.addEventListener("scroll", updatePosition, true)
    window.addEventListener("resize", updatePosition)
    return () => {
      container.removeEventListener("mousemove", handleMouseMove)
      container.removeEventListener("mouseleave", handleMouseLeave)
      container.removeEventListener("scroll", updatePosition, true)
      window.removeEventListener("resize", updatePosition)
    }
  }, [container, editor.view, openMenu])

  return {
    hoveredCell,
    openMenu,
    setHoveredCell,
    setOpenMenu,
  }
}

type HandlePlacement = {
  left: number
  top: number
}

const TABLE_HANDLE_LONG_SIDE = 28
const TABLE_HANDLE_SHORT_SIDE = 20

function DocumentTableMenu({
  container,
  editor,
}: {
  container: HTMLDivElement | null
  editor: Editor
}) {
  const { hoveredCell, openMenu, setHoveredCell, setOpenMenu } = useTableMenu(
    editor,
    container
  )

  if (!container || !hoveredCell) return null

  const containerRect = container.getBoundingClientRect()
  const table = hoveredCell.cell.closest<HTMLElement>("table")
  if (!table) return null
  const tableRect = table.getBoundingClientRect()
  const rowRect = hoveredCell.row.getBoundingClientRect()
  const cellRect = hoveredCell.cell.getBoundingClientRect()
  const originLeft = containerRect.left + container.clientLeft
  const originTop = containerRect.top + container.clientTop

  const rowHandle: HandlePlacement = {
    left: tableRect.left - originLeft - TABLE_HANDLE_SHORT_SIDE / 2,
    top:
      rowRect.top - originTop + (rowRect.height - TABLE_HANDLE_LONG_SIDE) / 2,
  }

  const columnHandle: HandlePlacement = {
    left:
      cellRect.left -
      originLeft +
      (cellRect.width - TABLE_HANDLE_LONG_SIDE) / 2,
    top: tableRect.top - originTop - TABLE_HANDLE_SHORT_SIDE / 2,
  }

  function handleMenuOpenChange(kind: TableMenuKind, open: boolean) {
    setOpenMenu(open ? kind : null)
    if (!open) setHoveredCell(null)
  }

  return (
    <>
      <TableMenuHandle
        cell={hoveredCell.cell}
        editor={editor}
        isRow={true}
        placement={rowHandle}
        open={openMenu === "row"}
        onOpenChange={(open) => handleMenuOpenChange("row", open)}
      />
      <TableMenuHandle
        cell={hoveredCell.cell}
        editor={editor}
        isRow={false}
        placement={columnHandle}
        open={openMenu === "column"}
        onOpenChange={(open) => handleMenuOpenChange("column", open)}
      />
    </>
  )
}

function getCellPosition(editor: Editor, cell: HTMLElement) {
  const domPosition = editor.view.posAtDOM(cell, 0)
  const $position = editor.state.doc.resolve(domPosition)
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth)
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return $position.before(depth)
    }
  }
  return null
}

function selectTableAxis(editor: Editor, cell: HTMLElement, isRow: boolean) {
  const position = getCellPosition(editor, cell)
  if (position === null) return
  const $cell = editor.state.doc.resolve(position)
  const selection = isRow
    ? CellSelection.rowSelection($cell)
    : CellSelection.colSelection($cell)
  editor.view.dispatch(editor.state.tr.setSelection(selection))
}

function TableMenuHandle({
  editor,
  cell,
  isRow,
  placement,
  open,
  onOpenChange,
}: {
  editor: Editor
  cell: HTMLElement
  isRow: boolean
  placement: HandlePlacement
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const style: React.CSSProperties = isRow
    ? {
        left: placement.left,
        top: placement.top,
        width: TABLE_HANDLE_SHORT_SIDE,
        height: TABLE_HANDLE_LONG_SIDE,
      }
    : {
        left: placement.left,
        top: placement.top,
        width: TABLE_HANDLE_LONG_SIDE,
        height: TABLE_HANDLE_SHORT_SIDE,
      }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={isRow ? "行操作" : "列操作"}
          className="document-table-handle"
          data-open={open}
          data-orientation={isRow ? "vertical" : "horizontal"}
          onPointerDown={() => selectTableAxis(editor, cell, isRow)}
          type="button"
          style={style}
        >
          <GripVertical />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {isRow ? (
          <>
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().addRowBefore().run()}
            >
              <ArrowUp />
              在上方插入行
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().addRowAfter().run()}
            >
              <ArrowDown />
              在下方插入行
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().deleteRow().run()}
            >
              <Trash2 />
              删除当前行
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().addColumnBefore().run()}
            >
              <ArrowLeft />
              在左侧插入列
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().addColumnAfter().run()}
            >
              <ArrowRight />
              在右侧插入列
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().deleteColumn().run()}
            >
              <Trash2 />
              删除当前列
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type BlockFormat =
  | "paragraph"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bullet-list"
  | "ordered-list"
  | "task-list"
  | "blockquote"
  | "code-block"

type SelectionRange = { from: number; to: number }

type TextFormatSnapshot = {
  marks: Array<{ attrs: Record<string, unknown>; type: string }>
  textAlign: TextAlignment
}

function captureTextFormat(editor: Editor): TextFormatSnapshot {
  const { doc, selection, storedMarks } = editor.state
  let sourceMarks = selection.empty
    ? (storedMarks ?? selection.$from.marks())
    : null

  if (!selection.empty) {
    doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!sourceMarks && node.isText) sourceMarks = node.marks
    })
  }

  const paragraphAlign = editor.getAttributes("paragraph").textAlign
  const headingAlign = editor.getAttributes("heading").textAlign
  const activeAlign = paragraphAlign ?? headingAlign
  const textAlign: TextAlignment =
    activeAlign === "center" || activeAlign === "right" ? activeAlign : "left"

  return {
    marks: (sourceMarks ?? [])
      .filter((mark) => mark.type.name !== "link")
      .map((mark) => ({ attrs: { ...mark.attrs }, type: mark.type.name })),
    textAlign,
  }
}

function applyTextFormat(editor: Editor, snapshot: TextFormatSnapshot) {
  let chain = editor.chain().focus().unsetAllMarks()
  for (const mark of snapshot.marks) {
    chain = chain.setMark(mark.type, mark.attrs)
  }
  chain =
    snapshot.textAlign === "left"
      ? chain.unsetTextAlign()
      : chain.setTextAlign(snapshot.textAlign)
  chain.run()
}

function DocumentToolbar({ editor }: { editor: Editor }) {
  const [formatPainterActive, setFormatPainterActive] = React.useState(false)
  const formatPainterRef = React.useRef<TextFormatSnapshot | null>(null)
  const formatPainterSourceRef = React.useRef<SelectionRange | null>(null)
  const paragraphAlign = editor.getAttributes("paragraph").textAlign as
    string | undefined
  const headingAlign = editor.getAttributes("heading").textAlign as
    string | undefined
  const activeAlign = paragraphAlign ?? headingAlign
  const currentAlign =
    activeAlign === "center" || activeAlign === "right" ? activeAlign : "left"

  React.useEffect(() => {
    if (!formatPainterActive) {
      editor.view.dom.classList.remove("document-format-painter-active")
      return
    }

    let animationFrame: number | null = null
    const cancelFormatPainter = () => {
      formatPainterRef.current = null
      formatPainterSourceRef.current = null
      setFormatPainterActive(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelFormatPainter()
    }
    const handleMouseUp = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        const snapshot = formatPainterRef.current
        const source = formatPainterSourceRef.current
        const { from, to } = editor.state.selection
        if (!snapshot || from === to) return
        if (source && source.from === from && source.to === to) return

        applyTextFormat(editor, snapshot)
        cancelFormatPainter()
      })
    }

    editor.view.dom.classList.add("document-format-painter-active")
    editor.view.dom.addEventListener("keydown", handleKeyDown)
    editor.view.dom.addEventListener("mouseup", handleMouseUp)
    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      editor.view.dom.classList.remove("document-format-painter-active")
      editor.view.dom.removeEventListener("keydown", handleKeyDown)
      editor.view.dom.removeEventListener("mouseup", handleMouseUp)
    }
  }, [editor, formatPainterActive])

  function toggleFormatPainter() {
    if (formatPainterActive) {
      formatPainterRef.current = null
      formatPainterSourceRef.current = null
      setFormatPainterActive(false)
      return
    }

    formatPainterRef.current = captureTextFormat(editor)
    formatPainterSourceRef.current = {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }
    setFormatPainterActive(true)
  }

  function clearFormatting() {
    formatPainterRef.current = null
    formatPainterSourceRef.current = null
    setFormatPainterActive(false)
    editor.chain().focus().unsetAllMarks().clearNodes().run()
  }

  return (
    <div
      aria-label="文档格式工具栏"
      className="flex h-12 shrink-0 items-center justify-center gap-0.5 overflow-x-auto border-b bg-background px-3 py-1.5"
      role="toolbar"
    >
      <ToolbarButton
        disabled={!editor.can().chain().focus().undo().run()}
        label="撤销"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        disabled={!editor.can().chain().focus().redo().run()}
        label="重做"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 />
      </ToolbarButton>
      <DocumentControlSeparator />
      <ToolbarButton
        active={formatPainterActive}
        label={formatPainterActive ? "取消格式刷" : "格式刷"}
        onClick={toggleFormatPainter}
      >
        <PaintRoller />
      </ToolbarButton>
      <ToolbarButton label="清除格式" onClick={clearFormatting}>
        <RemoveFormatting />
      </ToolbarButton>
      <DocumentControlSeparator />
      <ToolbarButton
        active={editor.isActive("bold")}
        label="粗体"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("italic")}
        label="斜体"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("underline")}
        label="下划线"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("strike")}
        label="删除线"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <TextColorMenu editor={editor} />
      <TextHighlightMenu editor={editor} />
      <DocumentControlSeparator />
      <ToolbarButton
        active={editor.isActive("bulletList")}
        label="无序列表"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("orderedList")}
        label="有序列表"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        active={editor.isActive("taskList")}
        label="待办列表"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo />
      </ToolbarButton>
      <DocumentControlSeparator />
      <TextAlignmentMenu currentAlign={currentAlign} editor={editor} />
      <DocumentControlSeparator />
      <LinkMenu editor={editor} />
      <DocumentControlSeparator />
      <ToolbarButton
        disabled={!editor.can().chain().focus().setHorizontalRule().run()}
        label="插入分割线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus />
      </ToolbarButton>
      <TableInsertMenu editor={editor} />
      <ImageInsertButton editor={editor} />
    </div>
  )
}

type TextAlignment = "center" | "left" | "right"

const textAlignmentOptions = [
  { icon: AlignLeft, label: "左对齐", value: "left" },
  { icon: AlignCenter, label: "居中对齐", value: "center" },
  { icon: AlignRight, label: "右对齐", value: "right" },
] as const

function TextAlignmentMenu({
  currentAlign,
  editor,
}: {
  currentAlign: TextAlignment
  editor: Editor
}) {
  const currentOption =
    textAlignmentOptions.find((option) => option.value === currentAlign) ??
    textAlignmentOptions[0]
  const CurrentIcon = currentOption.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`文本对齐：${currentOption.label}`}
          className="gap-1 px-2"
          size="sm"
          title={currentOption.label}
          type="button"
          variant="ghost"
        >
          <CurrentIcon />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {textAlignmentOptions.map((option) => (
          <DropdownMenuItem
            className={cn(currentAlign === option.value && "bg-muted")}
            key={option.value}
            onSelect={() =>
              editor.chain().focus().setTextAlign(option.value).run()
            }
          >
            <option.icon />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ImageInsertButton({ editor }: { editor: Editor }) {
  function insertPlaceholder() {
    const inserted = editor
      .chain()
      .focus()
      .insertContent({
        attrs: { alt: "", externalUrl: null, fileId: null },
        type: DocumentImage.name,
      })
      .run()
    if (!inserted) toast.error("无法在当前位置插入图片")
  }

  return (
    <Button
      aria-label="插入图片"
      onClick={insertPlaceholder}
      size="icon-sm"
      title="插入图片"
      type="button"
      variant="ghost"
    >
      <ImagePlus />
    </Button>
  )
}

function TableInsertMenu({ editor }: { editor: Editor }) {
  const canInsert = editor
    .can()
    .chain()
    .focus()
    .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
    .run()

  return (
    <DocumentTableInsertMenu
      disabled={!canInsert}
      onInsert={(rows, columns) => {
        editor
          .chain()
          .focus()
          .insertTable({ cols: columns, rows, withHeaderRow: true })
          .run()
      }}
    />
  )
}

const documentColorShades = [100, 300, 500, 700, 900] as const

const documentColorRows = [
  {
    name: "red",
    values: [
      "oklch(93.6% 0.032 17.717)",
      "oklch(80.8% 0.114 19.571)",
      "oklch(63.7% 0.237 25.331)",
      "oklch(50.5% 0.213 27.518)",
      "oklch(39.6% 0.141 25.723)",
    ],
  },
  {
    name: "amber",
    values: [
      "oklch(96.2% 0.059 95.617)",
      "oklch(87.9% 0.169 91.605)",
      "oklch(76.9% 0.188 70.08)",
      "oklch(55.5% 0.163 48.998)",
      "oklch(41.4% 0.112 45.904)",
    ],
  },
  {
    name: "lime",
    values: [
      "oklch(96.7% 0.067 122.328)",
      "oklch(89.7% 0.196 126.665)",
      "oklch(76.8% 0.233 130.85)",
      "oklch(53.2% 0.157 131.589)",
      "oklch(40.5% 0.101 131.063)",
    ],
  },
  {
    name: "emerald",
    values: [
      "oklch(95% 0.052 163.051)",
      "oklch(84.5% 0.143 164.978)",
      "oklch(69.6% 0.17 162.48)",
      "oklch(50.8% 0.118 165.612)",
      "oklch(37.8% 0.077 168.94)",
    ],
  },
  {
    name: "cyan",
    values: [
      "oklch(95.6% 0.045 203.388)",
      "oklch(86.5% 0.127 207.078)",
      "oklch(71.5% 0.143 215.221)",
      "oklch(52% 0.105 223.128)",
      "oklch(39.8% 0.07 227.392)",
    ],
  },
  {
    name: "blue",
    values: [
      "oklch(93.2% 0.032 255.585)",
      "oklch(80.9% 0.105 251.813)",
      "oklch(62.3% 0.214 259.815)",
      "oklch(48.8% 0.243 264.376)",
      "oklch(37.9% 0.146 265.522)",
    ],
  },
  {
    name: "violet",
    values: [
      "oklch(94.3% 0.029 294.588)",
      "oklch(81.1% 0.111 293.571)",
      "oklch(60.6% 0.25 292.717)",
      "oklch(49.1% 0.27 292.581)",
      "oklch(38% 0.189 293.745)",
    ],
  },
  {
    name: "fuchsia",
    values: [
      "oklch(95.2% 0.037 318.852)",
      "oklch(83.3% 0.145 321.434)",
      "oklch(66.7% 0.295 322.15)",
      "oklch(51.8% 0.253 323.949)",
      "oklch(40.1% 0.17 325.612)",
    ],
  },
  {
    name: "olive",
    values: [
      "oklch(96.6% 0.005 106.5)",
      "oklch(88% 0.011 106.6)",
      "oklch(58% 0.031 107.3)",
      "oklch(39.4% 0.023 107.4)",
      "oklch(22.8% 0.013 107.4)",
    ],
  },
  {
    name: "gray",
    values: [
      "oklch(96.7% 0.003 264.542)",
      "oklch(87.2% 0.01 258.338)",
      "oklch(55.1% 0.027 264.364)",
      "oklch(37.3% 0.034 259.733)",
      "oklch(21% 0.034 264.665)",
    ],
  },
] as const

const documentColors = documentColorShades.flatMap((shade, shadeIndex) =>
  documentColorRows.map((row) => ({
    label: `${row.name} ${shade}`,
    value: row.values[shadeIndex],
  }))
)

type DocumentColorPaletteProps = {
  label: string
  onColorSelect: (color: string | null) => void
  resetLabel: string
  resetSwatchClassName: string
}

function DocumentColorPalette(props: DocumentColorPaletteProps) {
  return (
    <DropdownMenuContent align="center" className="w-auto">
      <DocumentColorPaletteItems {...props} />
    </DropdownMenuContent>
  )
}

function DocumentColorPaletteItems({
  label,
  onColorSelect,
  resetLabel,
  resetSwatchClassName,
}: DocumentColorPaletteProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-1">
        <DropdownMenuLabel className="px-1">{label}</DropdownMenuLabel>
        <DropdownMenuItem
          className="h-7 px-2"
          onSelect={() => onColorSelect(null)}
        >
          <span
            className={cn("size-4 rounded-full border", resetSwatchClassName)}
          />
          {resetLabel}
        </DropdownMenuItem>
      </div>
      <DropdownMenuSeparator />
      <div className="grid grid-cols-10 gap-0.5 p-1">
        {documentColors.map((color) => (
          <DropdownMenuItem
            aria-label={color.label}
            className="size-6 justify-center rounded-full p-0"
            key={color.label}
            onSelect={() => onColorSelect(color.value)}
            title={color.label}
          >
            <span
              className="size-4 rounded-full border border-black/10"
              style={{ backgroundColor: color.value }}
            />
          </DropdownMenuItem>
        ))}
      </div>
    </>
  )
}

function TextColorMenu({ editor }: { editor: Editor }) {
  function setTextColor(color: string | null) {
    if (color) editor.chain().focus().setColor(color).run()
    else editor.chain().focus().unsetColor().run()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="字体颜色"
          size="icon-sm"
          title="字体颜色"
          type="button"
          variant="ghost"
        >
          <Baseline />
        </Button>
      </DropdownMenuTrigger>
      <DocumentColorPalette
        label="字体颜色"
        onColorSelect={setTextColor}
        resetLabel="默认颜色"
        resetSwatchClassName="bg-foreground"
      />
    </DropdownMenu>
  )
}

function TextHighlightMenu({ editor }: { editor: Editor }) {
  function setTextHighlight(color: string | null) {
    if (color) editor.chain().focus().setHighlight({ color }).run()
    else editor.chain().focus().unsetHighlight().run()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="文字背景色"
          size="icon-sm"
          title="文字背景色"
          type="button"
          variant="ghost"
        >
          <Paintbrush />
        </Button>
      </DropdownMenuTrigger>
      <DocumentColorPalette
        label="文字背景色"
        onColorSelect={setTextHighlight}
        resetLabel="无背景色"
        resetSwatchClassName="bg-background"
      />
    </DropdownMenu>
  )
}

function LinkMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")
  const linkActive = editor.isActive("link")

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const href = editor.getAttributes("link").href
      setUrl(typeof href === "string" ? href : "")
    }
    setOpen(nextOpen)
  }

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = url.trim()
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      setOpen(false)
      return
    }

    const href = /^(https?:\/\/|mailto:|tel:)/i.test(value)
      ? value
      : `https://${value}`
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    setOpen(false)
  }

  function removeLink() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    setOpen(false)
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="链接"
          aria-pressed={linkActive || undefined}
          className={cn(linkActive && "bg-muted text-foreground")}
          size="icon-sm"
          title="链接"
          type="button"
          variant="ghost"
        >
          <LinkIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="flex items-center gap-2" onSubmit={applyLink}>
          <Input
            aria-label="链接地址"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder="输入链接地址"
            value={url}
          />
          <Button size="sm" type="submit">
            应用
          </Button>
          {linkActive && (
            <Button
              aria-label="移除链接"
              onClick={removeLink}
              size="icon-sm"
              title="移除链接"
              type="button"
              variant="ghost"
            >
              <Unlink />
            </Button>
          )}
        </form>
      </PopoverContent>
    </Popover>
  )
}

function ToolbarButton({
  active = false,
  children,
  className,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean
  children: React.ReactNode
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active || undefined}
      className={cn(active && "bg-muted text-foreground", className)}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}
