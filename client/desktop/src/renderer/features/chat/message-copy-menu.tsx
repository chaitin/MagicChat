import { useRef, type ReactNode } from "react"
import { Copy01Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody } from "../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import { resolveMessageBodyCopyPayload } from "./message-copy"

export function MessageCopyMenu({
  body,
  summary,
  targetId,
  className,
  children,
}: {
  body: DesktopMessageBody
  summary: string
  targetId: string
  className?: string
  children: ReactNode
}) {
  const { showToast } = useAnimatedToast()
  const triggerRef = useRef<HTMLDivElement>(null)
  const selectedCopyTextRef = useRef("")

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

  async function copyMessage() {
    const payload = resolveMessageBodyCopyPayload(body, summary, selectedCopyTextRef.current)
    selectedCopyTextRef.current = ""
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
        <ContextMenuItem
          className="hover:bg-accent hover:text-accent-foreground"
          onSelect={() => void copyMessage()}
        >
          <HugeiconsIcon icon={Copy01Icon} className="size-4" aria-hidden />
          复制
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
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
