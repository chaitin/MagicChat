import * as React from "react"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import CodeMirror from "@uiw/react-codemirror"
import {
  Bold,
  Columns2,
  Eye,
  ImagePlus,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pencil,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react"
import { useTheme } from "next-themes"
import * as Y from "yjs"
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next"

import { DocumentControlSeparator } from "@/components/documents/document-control-separator"
import {
  transformMarkdownList,
  type MarkdownListType,
} from "@/components/documents/markdown-document-list-command"
import { DocumentTableInsertMenu } from "@/components/documents/document-table-insert-menu"
import { MarkdownRenderer } from "@/components/message-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import "./markdown-document-editor.css"

type MarkdownViewMode = "edit" | "preview" | "split"
type MarkdownHistoryState = { canRedo: boolean; canUndo: boolean }

const markdownSourceTheme = EditorView.theme({
  ".cm-scroller, .cm-scroller *": {
    fontFamily: "var(--font-mono)",
  },
})

export function MarkdownDocumentEditor({
  collaborationDocument,
  collaborationProvider,
  onTitleBlur,
  onTitleChange,
  title,
}: {
  collaborationDocument: Y.Doc
  collaborationProvider: HocuspocusProvider
  onTitleBlur?: () => void
  onTitleChange: (title: string) => void
  title: string
}) {
  const markdownText = React.useMemo(
    () => collaborationDocument.getText("markdown"),
    [collaborationDocument]
  )
  const markdownSource = useMarkdownPreviewSource(markdownText)
  const [viewMode, setViewMode] = React.useState<MarkdownViewMode>("split")
  const [showLineNumbers, setShowLineNumbers] = React.useState(true)
  const [editorView, setEditorView] = React.useState<EditorView | null>(null)
  const undoManager = React.useMemo(
    () => new Y.UndoManager(markdownText),
    [markdownText]
  )
  const [historyState, setHistoryState] = React.useState<MarkdownHistoryState>({
    canRedo: false,
    canUndo: false,
  })

  React.useEffect(() => {
    const updateHistoryState = () => {
      const next = {
        canRedo: undoManager.redoStack.length > 0,
        canUndo: undoManager.undoStack.length > 0,
      }
      setHistoryState((current) =>
        current.canRedo === next.canRedo && current.canUndo === next.canUndo
          ? current
          : next
      )
    }
    undoManager.on("stack-item-added", updateHistoryState)
    undoManager.on("stack-item-popped", updateHistoryState)
    undoManager.on("stack-item-updated", updateHistoryState)
    return () => {
      undoManager.off("stack-item-added", updateHistoryState)
      undoManager.off("stack-item-popped", updateHistoryState)
      undoManager.off("stack-item-updated", updateHistoryState)
    }
  }, [undoManager])

  const editingDisabled = !editorView || viewMode === "preview"

  function undo() {
    if (!editorView) return
    undoManager.undo()
    editorView.focus()
  }

  function redo() {
    if (!editorView) return
    undoManager.redo()
    editorView.focus()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-12 shrink-0 overflow-x-auto border-b bg-background px-3">
        <div className="mx-auto flex h-full w-max items-center justify-center gap-1">
          <MarkdownToolbarButton
            disabled={editingDisabled || !historyState.canUndo}
            icon={Undo2}
            label="撤销"
            onClick={undo}
          />
          <MarkdownToolbarButton
            disabled={editingDisabled || !historyState.canRedo}
            icon={Redo2}
            label="重做"
            onClick={redo}
          />
          <DocumentControlSeparator />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={Bold}
            label="粗体"
            onClick={() =>
              editorView && toggleMarkdownWrap(editorView, "**", "粗体文本")
            }
          />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={Italic}
            label="斜体"
            onClick={() =>
              editorView && toggleMarkdownWrap(editorView, "_", "斜体文本")
            }
          />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={Strikethrough}
            label="删除线"
            onClick={() =>
              editorView && toggleMarkdownWrap(editorView, "~~", "删除线文本")
            }
          />
          <DocumentControlSeparator />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={List}
            label="无序列表"
            onClick={() =>
              editorView && toggleMarkdownList(editorView, "bullet")
            }
          />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={ListOrdered}
            label="有序列表"
            onClick={() =>
              editorView && toggleMarkdownList(editorView, "ordered")
            }
          />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={ListTodo}
            label="任务列表"
            onClick={() => editorView && toggleMarkdownList(editorView, "task")}
          />
          <DocumentControlSeparator />
          <MarkdownLinkInsertMenu
            disabled={editingDisabled}
            view={editorView}
          />
          <MarkdownImageInsertMenu
            disabled={editingDisabled}
            view={editorView}
          />
          <MarkdownToolbarButton
            disabled={editingDisabled}
            icon={Minus}
            label="插入分割线"
            onClick={() => editorView && insertMarkdownBlock(editorView, "---")}
          />
          <DocumentTableInsertMenu
            disabled={editingDisabled}
            onInsert={(rows, columns) =>
              editorView && insertMarkdownTable(editorView, rows, columns)
            }
          />
          <DocumentControlSeparator />
          <MarkdownToolbarButton
            active={viewMode === "edit"}
            icon={Pencil}
            label="编辑"
            onClick={() => setViewMode("edit")}
          />
          <MarkdownToolbarButton
            active={viewMode === "split"}
            icon={Columns2}
            label="分屏"
            onClick={() => setViewMode("split")}
          />
          <MarkdownToolbarButton
            active={viewMode === "preview"}
            icon={Eye}
            label="预览"
            onClick={() => setViewMode("preview")}
          />
          <DocumentControlSeparator />
          <MarkdownToolbarButton
            active={showLineNumbers}
            icon={ListOrdered}
            label="行号"
            onClick={() => setShowLineNumbers((current) => !current)}
          />
        </div>
      </div>
      <div className="document-workspace-canvas min-h-0 flex-1 overflow-y-auto p-4">
        <div
          className={cn(
            "mx-auto grid min-h-full max-w-7xl gap-4",
            viewMode === "split" && "md:grid-cols-2"
          )}
        >
          <section
            className={cn(
              "flex min-w-0 flex-col border bg-background shadow-md",
              viewMode === "preview" && "hidden"
            )}
          >
            <input
              aria-label="文档页面标题"
              className="mx-8 mt-10 mb-6 border-b bg-transparent pb-5 text-4xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:mx-12"
              onBlur={onTitleBlur}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="无标题 Markdown"
              value={title}
            />
            <div className="min-w-0 flex-1">
              <MarkdownSourceEditor
                markdownText={markdownText}
                onEditorCreate={setEditorView}
                provider={collaborationProvider}
                showLineNumbers={showLineNumbers}
                undoManager={undoManager}
              />
            </div>
          </section>
          <section
            className={cn(
              "min-w-0 flex-col border bg-(--weui-bg-1) shadow-md",
              viewMode === "edit" ? "hidden" : "flex",
              viewMode === "split" && "hidden md:flex"
            )}
          >
            <h1
              aria-label="预览文档标题"
              className="mx-8 mt-10 mb-6 border-b pb-5 text-4xl font-bold tracking-tight break-words sm:mx-12"
            >
              {title.trim() || "无标题 Markdown"}
            </h1>
            <article
              aria-label="Markdown 预览"
              className="min-w-0 flex-1 overflow-hidden px-8 py-6 sm:px-12"
            >
              {markdownSource.trim() ? (
                <MarkdownRenderer content={markdownSource} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  在编辑区输入 Markdown 后，这里会显示预览。
                </p>
              )}
            </article>
          </section>
        </div>
      </div>
    </div>
  )
}

const MarkdownSourceEditor = React.memo(function MarkdownSourceEditor({
  markdownText,
  onEditorCreate,
  provider,
  showLineNumbers,
  undoManager,
}: {
  markdownText: Y.Text
  onEditorCreate: (view: EditorView) => void
  provider: HocuspocusProvider
  showLineNumbers: boolean
  undoManager: Y.UndoManager
}) {
  const { resolvedTheme } = useTheme()
  const extensions = React.useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      placeholder("开始撰写 Markdown…"),
      keymap.of(yUndoManagerKeymap),
      EditorView.lineWrapping,
      markdownSourceTheme,
      yCollab(markdownText, provider.awareness, { undoManager }),
    ],
    [markdownText, provider.awareness, undoManager]
  )

  return (
    <CodeMirror
      aria-label="Markdown 正文"
      basicSetup={{
        foldGutter: false,
        foldKeymap: false,
        history: false,
        historyKeymap: false,
        lineNumbers: showLineNumbers,
        searchKeymap: false,
      }}
      className="markdown-source-editor h-full"
      extensions={extensions}
      height="100%"
      onCreateEditor={onEditorCreate}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      value={markdownText.toString()}
    />
  )
})

function toggleMarkdownWrap(
  view: EditorView,
  marker: string,
  placeholderText: string
) {
  const selection = view.state.selection.main
  const selectedText = view.state.doc.sliceString(selection.from, selection.to)
  const markerLength = marker.length
  const markerBefore = view.state.doc.sliceString(
    Math.max(0, selection.from - markerLength),
    selection.from
  )
  const markerAfter = view.state.doc.sliceString(
    selection.to,
    selection.to + markerLength
  )

  if (
    selectedText &&
    markerBefore === marker &&
    markerAfter === marker &&
    selection.from >= markerLength
  ) {
    view.dispatch({
      changes: [
        { from: selection.from - markerLength, to: selection.from },
        { from: selection.to, to: selection.to + markerLength },
      ],
      selection: {
        anchor: selection.from - markerLength,
        head: selection.to - markerLength,
      },
    })
  } else if (
    selectedText.length >= markerLength * 2 &&
    selectedText.startsWith(marker) &&
    selectedText.endsWith(marker)
  ) {
    const content = selectedText.slice(markerLength, -markerLength)
    view.dispatch({
      changes: { from: selection.from, insert: content, to: selection.to },
      selection: {
        anchor: selection.from,
        head: selection.from + content.length,
      },
    })
  } else {
    const content = selectedText || placeholderText
    view.dispatch({
      changes: {
        from: selection.from,
        insert: `${marker}${content}${marker}`,
        to: selection.to,
      },
      selection: {
        anchor: selection.from + markerLength,
        head: selection.from + markerLength + content.length,
      },
    })
  }
  view.focus()
}

function toggleMarkdownList(view: EditorView, listType: MarkdownListType) {
  const selection = view.state.selection.main
  const startLine = view.state.doc.lineAt(selection.from)
  const effectiveEnd =
    selection.to > selection.from &&
    view.state.doc.lineAt(selection.to).from === selection.to
      ? selection.to - 1
      : selection.to
  const endLine = view.state.doc.lineAt(effectiveEnd)
  const source = view.state.doc.sliceString(startLine.from, endLine.to)
  const insert = transformMarkdownList(source, listType)

  view.dispatch({
    changes: { from: startLine.from, insert, to: endLine.to },
    selection: {
      anchor: startLine.from,
      head: startLine.from + insert.length,
    },
  })
  view.focus()
}

function insertMarkdownBlock(view: EditorView, block: string) {
  const selection = view.state.selection.main
  const before = view.state.doc.sliceString(0, selection.from)
  const after = view.state.doc.sliceString(selection.to)
  const insert = `${markdownBlockPrefix(before)}${block}${markdownBlockSuffix(after)}`
  view.dispatch({
    changes: { from: selection.from, insert, to: selection.to },
    scrollIntoView: true,
    selection: { anchor: selection.from + insert.length },
  })
  view.focus()
}

function MarkdownLinkInsertMenu({
  disabled,
  view,
}: {
  disabled: boolean
  view: EditorView | null
}) {
  const [open, setOpen] = React.useState(false)
  const [url, setUrl] = React.useState("")

  function applyLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !url.trim()) return
    const selection = view.state.selection.main
    const selectedText = view.state.doc.sliceString(
      selection.from,
      selection.to
    )
    const label = selectedText || "链接文字"
    const href = normalizeMarkdownLinkURL(url)
    const insert = `[${label.replaceAll("]", "\\]")}](${href})`
    view.dispatch({
      changes: { from: selection.from, insert, to: selection.to },
      selection: selectedText
        ? { anchor: selection.from + insert.length }
        : {
            anchor: selection.from + 1,
            head: selection.from + 1 + label.length,
          },
    })
    view.focus()
    setOpen(false)
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setUrl("")
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label="链接"
          disabled={disabled}
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
          <Button disabled={!url.trim()} size="sm" type="submit">
            应用
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function MarkdownImageInsertMenu({
  disabled,
  view,
}: {
  disabled: boolean
  view: EditorView | null
}) {
  const [open, setOpen] = React.useState(false)
  const [alt, setAlt] = React.useState("")
  const [url, setUrl] = React.useState("")

  function applyImage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!view || !url.trim()) return
    const selection = view.state.selection.main
    const imageAlt = alt.trim() || "图片"
    const insert = `![${imageAlt.replaceAll("]", "\\]")}](${normalizeMarkdownImageURL(url)})`
    view.dispatch({
      changes: { from: selection.from, insert, to: selection.to },
      selection: { anchor: selection.from + insert.length },
    })
    view.focus()
    setOpen(false)
  }

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setAlt("")
          setUrl("")
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label="插入图片"
          disabled={disabled}
          size="icon-sm"
          title="插入图片"
          type="button"
          variant="ghost"
        >
          <ImagePlus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 p-3">
        <form className="space-y-2" onSubmit={applyImage}>
          <Input
            aria-label="图片地址"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
            placeholder="输入图片地址"
            value={url}
          />
          <Input
            aria-label="图片描述"
            onChange={(event) => setAlt(event.target.value)}
            placeholder="图片描述（可选）"
            value={alt}
          />
          <div className="flex justify-end">
            <Button disabled={!url.trim()} size="sm" type="submit">
              插入
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function normalizeMarkdownLinkURL(value: string) {
  const url = value.trim()
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url) ? url : `https://${url}`
}

function normalizeMarkdownImageURL(value: string) {
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function insertMarkdownTable(view: EditorView, rows: number, columns: number) {
  const selection = view.state.selection.main
  const before = view.state.doc.sliceString(0, selection.from)
  const after = view.state.doc.sliceString(selection.to)
  const prefix = markdownBlockPrefix(before)
  const suffix = markdownBlockSuffix(after)
  const firstHeader = "列 1"
  const table = createMarkdownTable(rows, columns)
  const insert = `${prefix}${table}${suffix}`
  const headerFrom = selection.from + prefix.length + 2

  view.dispatch({
    changes: { from: selection.from, insert, to: selection.to },
    scrollIntoView: true,
    selection: {
      anchor: headerFrom,
      head: headerFrom + firstHeader.length,
    },
  })
  view.focus()
}

function createMarkdownTable(rows: number, columns: number) {
  const normalizedRows = Math.max(1, rows)
  const normalizedColumns = Math.max(1, columns)
  const header = Array.from(
    { length: normalizedColumns },
    (_, index) => `列 ${index + 1}`
  )
  const separator = Array.from({ length: normalizedColumns }, () => "---")
  const bodyRow = Array.from({ length: normalizedColumns }, () => "")
  const lines = [markdownTableRow(header), markdownTableRow(separator)]

  for (let row = 1; row < normalizedRows; row += 1) {
    lines.push(markdownTableRow(bodyRow))
  }
  return lines.join("\n")
}

function markdownTableRow(cells: string[]) {
  return `| ${cells.join(" | ")} |`
}

function markdownBlockPrefix(before: string) {
  if (!before || before.endsWith("\n\n")) return ""
  return before.endsWith("\n") ? "\n" : "\n\n"
}

function markdownBlockSuffix(after: string) {
  if (!after || after.startsWith("\n\n")) return ""
  return after.startsWith("\n") ? "\n" : "\n\n"
}

function MarkdownToolbarButton({
  active,
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean
  disabled?: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      size="icon-sm"
      title={label}
      type="button"
      variant={active ? "secondary" : "ghost"}
    >
      <Icon className="size-4" />
    </Button>
  )
}

function useMarkdownPreviewSource(markdownText: Y.Text) {
  const [source, setSource] = React.useState(() => markdownText.toString())

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setSource(markdownText.toString()), 120)
    }
    markdownText.observe(update)
    return () => {
      markdownText.unobserve(update)
      if (timer) clearTimeout(timer)
    }
  }, [markdownText])

  return source
}
