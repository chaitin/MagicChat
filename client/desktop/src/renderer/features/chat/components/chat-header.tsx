import {
  DotIcon,
  FolderAttachmentIcon,
  MessageMultiple02Icon,
  Settings02Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons"
import type { DesktopConversation } from "../../../../shared/account-data"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { HugeiconsIcon, type HugeiconsIconProps } from "@/components/icons/hugeicons-icon"
import { Button as BeButton } from "@/components/motion/button/base"
import { Loader } from "@/components/motion/loader"

export function ChatHeader({
  conversation,
  targetId,
  resolvedTheme,
  status,
  onPendingFeature,
}: {
  conversation: DesktopConversation
  targetId: string
  resolvedTheme: "light" | "dark"
  status?: string
  onPendingFeature: (label: string) => void
}) {
  const avatar = (
    <EntityAvatar
      targetId={targetId}
      type={conversation.avatarType}
      id={conversation.avatarId}
      theme={resolvedTheme}
      size={36}
      label={`${conversation.name}头像`}
    />
  )
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
  return (
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
        <h2 className="truncate text-sm">{conversation.name}</h2>
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{conversationDescription(conversation)}</span>
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
            onClick={() => onPendingFeature("话题列表")}
          />
        )}
        {conversation.type === "group" && (
          <HeaderActionButton
            label="添加成员"
            icon={UserAdd01Icon}
            onClick={() => onPendingFeature("添加成员")}
          />
        )}
        {conversation.type !== "topic" && (
          <HeaderActionButton
            label="附件列表"
            icon={FolderAttachmentIcon}
            onClick={() => onPendingFeature("附件列表")}
          />
        )}
        {conversation.type !== "topic" && (
          <HeaderActionButton
            label="对话设置"
            icon={Settings02Icon}
            onClick={() => onPendingFeature("对话设置")}
          />
        )}
      </div>
    </header>
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

function conversationDescription(conversation: DesktopConversation): string {
  if (conversation.type === "group") return `群聊 - ${conversation.memberCount} 人`
  if (conversation.type === "app") return "应用会话"
  if (conversation.type === "topic") return "话题"
  return "单聊"
}
