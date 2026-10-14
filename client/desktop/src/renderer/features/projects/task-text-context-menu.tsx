import { useRef, useState, type ReactElement } from "react"
import {
  ClipboardPasteIcon,
  Copy01Icon,
  Delete02Icon,
  Scissor01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

type TextSelection =
  | {
      kind: "input"
      element: HTMLInputElement | HTMLTextAreaElement
      start: number
      end: number
      direction: "forward" | "backward" | "none"
    }
  | { kind: "range"; element: HTMLElement; range: Range }

function captureSelection(element: HTMLElement | null): TextSelection | null {
  if (!element) return null
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return {
      kind: "input",
      element,
      start: element.selectionStart ?? 0,
      end: element.selectionEnd ?? 0,
      direction: element.selectionDirection ?? "none",
    }
  }
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null
  return { kind: "range", element, range: range.cloneRange() }
}

function hasSelectedText(selection: TextSelection | null): boolean {
  if (!selection) return false
  return selection.kind === "input"
    ? selection.start !== selection.end
    : Boolean(selection.range.toString())
}

function restoreSelection(selection: TextSelection | null): boolean {
  if (!selection?.element.isConnected) return false
  if (
    selection.kind === "range" &&
    (!selection.range.startContainer.isConnected || !selection.range.endContainer.isConnected)
  ) {
    return false
  }
  selection.element.focus({ preventScroll: true })
  if (document.activeElement !== selection.element) return false
  if (selection.kind === "input") {
    selection.element.setSelectionRange(selection.start, selection.end, selection.direction)
  } else {
    const current = window.getSelection()
    if (!current) return false
    current.removeAllRanges()
    current.addRange(selection.range)
  }
  return true
}

export function TaskTextContextMenu({
  children,
  editable = false,
  disabled = false,
}: {
  children: ReactElement
  editable?: boolean
  disabled?: boolean
}) {
  const { showToast } = useAnimatedToast()
  const targetRef = useRef<HTMLElement>(null)
  const selectionRef = useRef<TextSelection | null>(null)
  const rightClickSelectionRef = useRef<TextSelection | null>(null)
  const keepSelectionFocusedRef = useRef(false)
  const [hasSelection, setHasSelection] = useState(false)

  function editSelection(action: "copy" | "cut" | "paste" | "delete") {
    if (action !== "copy" && (!editable || disabled)) return
    const selection = selectionRef.current
    requestAnimationFrame(() => {
      if (!restoreSelection(selection) || !window.taskWindow) return
      if (
        action !== "copy" &&
        (selection?.kind !== "input" || selection.element.readOnly || selection.element.disabled)
      )
        return
      void window.taskWindow
        .editText(action)
        .then((result) => {
          if (!result.ok) showToast({ status: "error", title: result.error.message })
        })
        .catch(() => showToast({ status: "error", title: "文本操作失败" }))
    })
  }

  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open || !keepSelectionFocusedRef.current) return
        requestAnimationFrame(() => restoreSelection(selectionRef.current))
      }}
    >
      <ContextMenuTrigger
        asChild
        ref={targetRef}
        className="select-text"
        tabIndex={editable ? undefined : -1}
        onPointerDownCapture={(event) => {
          rightClickSelectionRef.current = null
          if (event.button !== 2) return
          const selection = captureSelection(targetRef.current)
          if (!hasSelectedText(selection)) return
          rightClickSelectionRef.current = selection
          event.preventDefault()
        }}
        onContextMenu={() => {
          keepSelectionFocusedRef.current = rightClickSelectionRef.current !== null
          const selection = rightClickSelectionRef.current ?? captureSelection(targetRef.current)
          rightClickSelectionRef.current = null
          selectionRef.current = selection
          setHasSelection(hasSelectedText(selection))
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onFocusOutside={(event) => {
          if (keepSelectionFocusedRef.current) event.preventDefault()
        }}
      >
        <ContextMenuItem disabled={!hasSelection} onSelect={() => editSelection("copy")}>
          <HugeiconsIcon icon={Copy01Icon} aria-hidden />
          复制
        </ContextMenuItem>
        {editable && (
          <>
            <ContextMenuItem
              disabled={disabled || !hasSelection}
              onSelect={() => editSelection("cut")}
            >
              <HugeiconsIcon icon={Scissor01Icon} aria-hidden />
              剪切
            </ContextMenuItem>
            <ContextMenuItem disabled={disabled} onSelect={() => editSelection("paste")}>
              <HugeiconsIcon icon={ClipboardPasteIcon} aria-hidden />
              粘贴
            </ContextMenuItem>
            <ContextMenuItem
              disabled={disabled || !hasSelection}
              onSelect={() => editSelection("delete")}
            >
              <HugeiconsIcon icon={Delete02Icon} aria-hidden />
              删除
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
