import { useRef, useState, type ReactNode, type RefObject } from "react"
import {
  ArrowTurnForwardIcon,
  Copy01Icon,
  ListIcon,
  MessageMultiple02Icon,
  ReplyIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { resolveMessageBodyCopyPayload } from "./message-copy"

type MessageActionMenuProps = {
  body: DesktopMessageBody
  summary: string
  targetId: string
  onReply?: () => void
  onForward?: () => void
  onMultiSelect?: () => void
  onCreateTopic?: () => void
  onRevoke?: () => void | Promise<void>
}

export function MessageCopyMenu({
  body,
  summary,
  targetId,
  className,
  menuTriggerRef,
  children,
  onReply,
  onForward,
  onMultiSelect,
  onCreateTopic,
  onRevoke,
}: MessageActionMenuProps & {
  className?: string
  menuTriggerRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const internalTriggerRef = useRef<HTMLDivElement>(null)
  const triggerRef = menuTriggerRef ?? internalTriggerRef
  const selectedCopyTextRef = useRef("")
  const [menuOpen, setMenuOpen] = useState(false)
  const copyMessage = useMessageCopy(body, summary, targetId)

  function captureSelectedCopyText(event: React.MouseEvent) {
    const trigger = triggerRef.current
    if (!(event.target instanceof Node) || !trigger?.contains(event.target)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    selectedCopyTextRef.current = getSelectedTextWithinElement(trigger)
    event.stopPropagation()
  }

  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
          data-menu-open={menuOpen ? "" : undefined}
          className={cn("select-text", className)}
          onContextMenu={captureSelectedCopyText}
        >
          {children}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MessageActionMenuItems
          kind="context"
          onCopy={() => {
            const selectedText = selectedCopyTextRef.current
            selectedCopyTextRef.current = ""
            void copyMessage(selectedText)
          }}
          onCreateTopic={onCreateTopic}
          onReply={onReply}
          onForward={onForward}
          onMultiSelect={onMultiSelect}
          onRevoke={onRevoke}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function MessageActionsDropdown({
  body,
  summary,
  targetId,
  selectionContainerRef,
  children,
  onReply,
  onForward,
  onMultiSelect,
  onCreateTopic,
  onRevoke,
}: MessageActionMenuProps & {
  selectionContainerRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const selectedCopyTextRef = useRef("")
  const copyMessage = useMessageCopy(body, summary, targetId)

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          selectedCopyTextRef.current = getSelectedTextWithinElement(selectionContainerRef.current)
        }
      }}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <MessageActionMenuItems
          kind="dropdown"
          onCopy={() => {
            const selectedText = selectedCopyTextRef.current
            selectedCopyTextRef.current = ""
            void copyMessage(selectedText)
          }}
          onCreateTopic={onCreateTopic}
          onReply={onReply}
          onForward={onForward}
          onMultiSelect={onMultiSelect}
          onRevoke={onRevoke}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MessageActionMenuItems({
  kind,
  onCopy,
  onCreateTopic,
  onReply,
  onForward,
  onMultiSelect,
  onRevoke,
}: {
  kind: "context" | "dropdown"
  onCopy: () => void
  onCreateTopic?: () => void
  onReply?: () => void
  onForward?: () => void
  onMultiSelect?: () => void
  onRevoke?: () => void | Promise<void>
}) {
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem
  const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <>
      <Item onSelect={onCopy}>
        <HugeiconsIcon icon={Copy01Icon} className="size-4" aria-hidden />
        复制
      </Item>
      {onReply && (
        <Item onSelect={onReply}>
          <HugeiconsIcon icon={ReplyIcon} className="size-4" aria-hidden />
          回复
        </Item>
      )}
      {onForward && (
        <Item onSelect={onForward}>
          <HugeiconsIcon icon={ArrowTurnForwardIcon} className="size-4" aria-hidden />
          转发
        </Item>
      )}
      {onMultiSelect && (
        <Item onSelect={onMultiSelect}>
          <HugeiconsIcon icon={ListIcon} className="size-4" aria-hidden />
          多选
        </Item>
      )}
      {onCreateTopic && (
        <Item onSelect={onCreateTopic}>
          <HugeiconsIcon icon={MessageMultiple02Icon} className="size-4" aria-hidden />
          创建话题
        </Item>
      )}
      {onRevoke && (
        <>
          <Separator />
          <Item variant="destructive" onSelect={() => void onRevoke()}>
            <HugeiconsIcon icon={Undo02Icon} className="size-4" aria-hidden />
            撤回
          </Item>
        </>
      )}
    </>
  )
}

function useMessageCopy(body: DesktopMessageBody, summary: string, targetId: string) {
  const { showToast } = useAnimatedToast()
  return async (selectedText: string) => {
    const payload = resolveMessageBodyCopyPayload(body, summary, selectedText)
    if (!payload || !window.desktop) {
      showToast({ status: "error", title: "没有可复制内容" })
      return
    }
    try {
      const result =
        payload.type === "image"
          ? await window.desktop.media.copyImage({
              targetId,
              fileId: payload.fileId,
              category: "image",
            })
          : await window.desktop.copyText(payload.text)
      if (!result.ok) throw new Error(result.error.message)
      showToast({ status: "success", title: "已复制" })
    } catch (error) {
      showToast({
        status: "error",
        title: "复制失败",
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }
}

function getSelectedTextWithinElement(element: HTMLElement | null) {
  if (!element) return ""
  const selection = window.getSelection()
  const selectedText = selection?.toString() ?? ""
  if (!selection || selection.isCollapsed || !selectedText.trim()) return ""
  for (let index = 0; index < selection.rangeCount; index += 1) {
    try {
      if (selection.getRangeAt(index).intersectsNode(element)) return selectedText
    } catch {
      return ""
    }
  }
  return ""
}
