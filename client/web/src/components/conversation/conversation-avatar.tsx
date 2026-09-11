import { Bot } from "lucide-react"

import { GroupAvatar } from "@/components/group-avatar"
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import type { ClientConversation } from "@/lib/client-data-api"
import {
  getConversationAvatarName,
  getConversationAvatarType,
} from "@/lib/conversation-avatar-presentation"
import { cn } from "@/lib/utils"

export function ConversationAvatar({
  className,
  conversation,
  online,
  sourceAvatarClassName,
}: {
  className?: string
  conversation: ClientConversation
  online?: boolean
  sourceAvatarClassName?: string
}) {
  const avatarType = getConversationAvatarType(conversation)
  const avatarName = getConversationAvatarName(conversation)

  if (conversation.type === "topic") {
    const sourceSender = conversation.topic?.sourceSender
    return (
      <div className={cn("relative shrink-0", className)}>
        <BaseConversationAvatar
          avatarName={avatarName}
          avatarType={avatarType}
          className="size-full"
          conversation={conversation}
        />
        {sourceSender && (
          <span className="absolute -right-1 -bottom-1 rounded-full bg-background p-0.5 shadow-xs">
            <Avatar
              className={cn(
                "size-5 rounded-full bg-muted after:rounded-full",
                sourceAvatarClassName
              )}
            >
              {sourceSender.avatar && (
                <AvatarImage
                  alt={sourceSender.name}
                  className="rounded-full"
                  src={sourceSender.avatar}
                />
              )}
              <AvatarFallback
                aria-label={sourceSender.name}
                className="rounded-full text-[9px]"
              >
                {sourceSender.type === "app" ? (
                  <Bot className="size-1/2" />
                ) : (
                  getConversationInitial(sourceSender.name)
                )}
              </AvatarFallback>
            </Avatar>
          </span>
        )}
      </div>
    )
  }

  return (
    <BaseConversationAvatar
      avatarName={avatarName}
      avatarType={avatarType}
      className={className}
      conversation={conversation}
      online={online}
    />
  )
}

function BaseConversationAvatar({
  avatarName,
  avatarType,
  className,
  conversation,
  online,
}: {
  avatarName: string
  avatarType: "direct" | "group" | "app"
  className?: string
  conversation: ClientConversation
  online?: boolean
}) {
  if (avatarType === "group") {
    return (
      <GroupAvatar
        avatar={conversation.avatar}
        className={className}
        members={conversation.members}
        name={avatarName}
      />
    )
  }

  return (
    <Avatar className={cn("rounded-sm bg-muted after:rounded-sm", className)}>
      {conversation.avatar && (
        <AvatarImage
          alt={avatarName}
          className="rounded-sm"
          src={conversation.avatar}
        />
      )}
      <AvatarFallback className="rounded-sm">
        {avatarType === "app" ? (
          <Bot className="size-1/2" />
        ) : (
          getConversationInitial(avatarName)
        )}
      </AvatarFallback>
      {online !== undefined && (
        <AvatarBadge
          aria-label={online ? "在线" : "离线"}
          className={
            online ? "bg-emerald-500" : "bg-neutral-400 dark:bg-neutral-500"
          }
        />
      )}
    </Avatar>
  )
}

function getConversationInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
