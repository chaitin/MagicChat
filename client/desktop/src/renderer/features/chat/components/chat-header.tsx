import {
  DotIcon,
  FolderAttachmentIcon,
  MessageMultiple02Icon,
  Settings02Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons"
import { Fragment, useEffect, useState } from "react"
import type { DesktopConversation } from "../../../../shared/account-data"
import { ConversationHeaderPanel, type HeaderPanel } from "./conversation-header-panel"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Avatar, AvatarBadge } from "@/components/ui/avatar"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { Loader } from "@/components/motion/loader"
import { cn } from "@/lib/utils"

export function ChatHeader({
  conversation,
  targetId,
  resolvedTheme,
  status,
  onlineContactKeys,
  currentUserId,
  onLocateMessage,
  onConversationRemoved,
  onSetPinned,
  onSetMuted,
  onDismiss,
}: {
  conversation: DesktopConversation
  targetId: string
  resolvedTheme: "light" | "dark"
  status?: string
  onlineContactKeys: ReadonlySet<string> | null
  currentUserId: string
  onLocateMessage: (messageId: string) => Promise<boolean>
  onConversationRemoved: () => void
  onSetPinned: (conversationId: string, pinned: boolean) => Promise<void>
  onSetMuted: (conversationId: string, muted: boolean) => Promise<void>
  onDismiss: (conversationId: string) => Promise<void>
}) {
  const [panel, setPanel] = useState<{ conversationId: string; kind: HeaderPanel } | null>(null)
  useEffect(() => setPanel(null), [conversation.id])
  const openPanel = (kind: HeaderPanel) => setPanel({ conversationId: conversation.id, kind })
  const profileType =
    conversation.type === "group" || conversation.type === "app"
      ? conversation.type
      : conversation.type === "direct" && conversation.avatarType === "user"
        ? "user"
        : null
  const profileId =
    conversation.type === "group"
      ? conversation.id
      : conversation.type === "app"
        ? conversation.avatarType === "app"
          ? conversation.avatarId
          : conversation.id
        : conversation.avatarId
  const online =
    (profileType === "user" || profileType === "app") &&
    onlineContactKeys?.has(`${profileType}:${profileId.toLowerCase()}`)
  const avatar = (
    <Avatar className="size-9! rounded-sm after:hidden">
      <EntityAvatar
        targetId={targetId}
        type={conversation.avatarType}
        id={conversation.avatarId}
        theme={resolvedTheme}
        size={36}
        label={`${conversation.name}头像`}
      />
      {(profileType === "user" || profileType === "app") && (
        <AvatarBadge
          className={cn("size-2.5!", online ? "bg-xgui-brand" : "bg-muted-foreground")}
          aria-label={online ? "在线" : "离线"}
        />
      )}
    </Avatar>
  )
  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-xgui-background-1 px-4">
        {profileType ? (
          <ContactProfilePopover
            key={`${profileType}:${profileId}`}
            type={profileType}
            id={profileId}
            fallbackName={conversation.name}
            fallbackMemberCount={conversation.memberCount}
          >
            {avatar}
          </ContactProfilePopover>
        ) : (
          avatar
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="min-w-0 truncate text-sm">{conversation.name}</h2>
          </div>
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {conversationDescription(conversation).map((segment, index) => (
              <Fragment key={segment}>
                {index > 0 && (
                  <HugeiconsIcon icon={DotIcon} className="size-3 shrink-0" aria-hidden />
                )}
                <span className={index === 0 ? "truncate" : "shrink-0"}>{segment}</span>
              </Fragment>
            ))}
            {status && (
              <>
                <HugeiconsIcon icon={DotIcon} className="size-3 shrink-0" aria-hidden />
                <span className="shrink-0">{status}</span>
                <Loader
                  variant="metaballs"
                  size={14}
                  speed={0.8}
                  label={status}
                  className="shrink-0 text-muted-foreground opacity-60"
                />
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {conversation.type !== "topic" && (
            <HeaderActionButton
              label="话题列表"
              icon={MessageMultiple02Icon}
              onClick={() => openPanel("topics")}
            />
          )}
          {conversation.type === "group" && (
            <HeaderActionButton
              label="添加成员"
              icon={UserAdd01Icon}
              onClick={() => openPanel("invite")}
            />
          )}
          {conversation.type !== "topic" && (
            <HeaderActionButton
              label="附件列表"
              icon={FolderAttachmentIcon}
              onClick={() => openPanel("attachments")}
            />
          )}
          <HeaderActionButton
            label="对话设置"
            icon={Settings02Icon}
            onClick={() => openPanel("info")}
          />
        </div>
      </header>
      {panel?.conversationId === conversation.id && (
        <ConversationHeaderPanel
          panel={panel.kind}
          conversation={conversation}
          targetId={targetId}
          currentUserId={currentUserId}
          theme={resolvedTheme}
          onClose={() => setPanel(null)}
          onLocateMessage={onLocateMessage}
          onConversationRemoved={onConversationRemoved}
          onSetPinned={onSetPinned}
          onSetMuted={onSetMuted}
          onDismiss={onDismiss}
        />
      )}
    </>
  )
}

function HeaderActionButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: HugeiconsIconProps["icon"]
  onClick: () => void
}) {
  return (
    <BeButton
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0 rounded-lg hover:bg-foreground/10 [&_svg]:size-4"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} aria-hidden />
    </BeButton>
  )
}

// 分段返回，段之间统一用圆点图标分隔，避免使用减号等字符。
function conversationDescription(conversation: DesktopConversation): string[] {
  if (conversation.type === "group") return ["群聊", `${conversation.memberCount} 人`]
  if (conversation.type === "app") return ["应用会话"]
  if (conversation.type === "topic") return ["话题"]
  return ["单聊"]
}
