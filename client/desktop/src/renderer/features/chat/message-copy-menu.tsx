import { useRef, type ReactNode, type RefObject } from "react"
import {
  Copy01Icon,
  Edit02Icon,
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
  onCreateTopic?: () => void
  onRevoke?: () => void | Promise<void>
  showEdit?: boolean
}

export function MessageCopyMenu({
  body,
  summary,
  targetId,
  className,
  menuTriggerRef,
  children,
  onReply,
  onCreateTopic,
  onRevoke,
  showEdit = false,
}: MessageActionMenuProps & {
  className?: string
  menuTriggerRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const { showToast } = useAnimatedToast()
  const internalTriggerRef = useRef<HTMLDivElement>(null)
  const triggerRef = menuTriggerRef ?? internalTriggerRef
  const selectedCopyTextRef = useRef("")
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={triggerRef}
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
          onEdit={
            showEdit ? () => showToast({ status: "warning", title: "暂时没有后悔药" }) : undefined
          }
          onReply={onReply}
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
  onCreateTopic,
  onRevoke,
  showEdit = false,
}: MessageActionMenuProps & {
  selectionContainerRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const { showToast } = useAnimatedToast()
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
          onEdit={
            showEdit ? () => showToast({ status: "warning", title: "暂时没有后悔药" }) : undefined
          }
          onReply={onReply}
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
  onEdit,
  onReply,
  onRevoke,
}: {
  kind: "context" | "dropdown"
  onCopy: () => void
  onCreateTopic?: () => void
  onEdit?: () => void
  onReply?: () => void
  onRevoke?: () => void | Promise<void>
}) {
  const Item = kind === "context" ? ContextMenuItem : DropdownMenuItem
  const Separator = kind === "context" ? ContextMenuSeparator : DropdownMenuSeparator
  return (
    <>
      {onReply && (
        <Item onSelect={onReply}>
          <HugeiconsIcon icon={ReplyIcon} className="size-4" aria-hidden />
          回复
        </Item>
      )}
      <Item onSelect={onCopy}>
        <HugeiconsIcon icon={Copy01Icon} className="size-4" aria-hidden />
        复制
      </Item>
      {onEdit && (
        <Item onSelect={onEdit}>
          <HugeiconsIcon icon={Edit02Icon} className="size-4" aria-hidden />
          编辑
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
