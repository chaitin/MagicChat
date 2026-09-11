import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { Bell, BellOff, LoaderCircle, Pin, PinOff, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"

type ConversationListItemMenuProps = {
  children: React.ReactNode
  dismissing?: boolean
  muted?: boolean
  muting?: boolean
  onDismiss?: () => void
  onMutedChange?: (muted: boolean) => void
  onPinnedChange?: (pinned: boolean) => void
  showPinAction?: boolean
  pinned?: boolean
  pinning?: boolean
}

export function ConversationListItemMenu({
  children,
  dismissing = false,
  muted = false,
  muting = false,
  onDismiss,
  onMutedChange,
  onPinnedChange,
  showPinAction = true,
  pinned = false,
  pinning = false,
}: ConversationListItemMenuProps) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className={cn(
            "z-50 min-w-36 overflow-hidden rounded-md bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10",
            "origin-(--radix-context-menu-content-transform-origin) duration-100",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          )}
          data-slot="conversation-list-item-menu"
        >
          {showPinAction && (
            <ContextMenuPrimitive.Item
              className={cn(
                "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none",
                "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
                "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
              )}
              data-slot="conversation-list-item-menu-item"
              disabled={pinning || !onPinnedChange}
              onSelect={() => onPinnedChange?.(!pinned)}
            >
              {pinning ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : pinned ? (
                <PinOff aria-hidden="true" className="size-4" />
              ) : (
                <Pin aria-hidden="true" className="size-4" />
              )}
              <span>{pinned ? "取消置顶" : "置顶对话"}</span>
            </ContextMenuPrimitive.Item>
          )}
          <ContextMenuPrimitive.Item
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none",
              "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
              "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            )}
            data-slot="conversation-list-item-menu-item"
            disabled={muting || !onMutedChange}
            onSelect={() => onMutedChange?.(!muted)}
          >
            {muting ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : muted ? (
              <Bell aria-hidden="true" className="size-4" />
            ) : (
              <BellOff aria-hidden="true" className="size-4" />
            )}
            <span>{muted ? "取消免打扰" : "消息免打扰"}</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-hidden select-none",
              "focus:bg-destructive/10 focus:text-destructive",
              "data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
            )}
            data-slot="conversation-list-item-menu-item"
            disabled={dismissing || !onDismiss}
            onSelect={onDismiss}
          >
            {dismissing ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
            <span>删除对话</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
