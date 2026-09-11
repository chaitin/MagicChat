import type { ReactNode } from "react"
import {
  Bot,
  MessagesSquare,
  Settings,
  UserRound,
  UsersRound,
} from "lucide-react"
import { type ClientConversation } from "@/lib/client-data-api"
import { AddGroupMembersDialog } from "@/components/add-group-members-dialog"
import { AppProfilePopover } from "@/components/app-profile-popover"
import { ConversationAttachmentsDialog } from "@/components/conversation/conversation-attachments-dialog"
import { ConversationAvatar } from "@/components/conversation/conversation-avatar"
import { ConversationStatusIndicator } from "@/components/conversation/conversation-status-indicator"
import { ConversationInfoDrawer } from "@/components/conversation-info-drawer"
import { GroupProfilePopover } from "@/components/group-profile-popover"
import { Button } from "@/components/ui/button"
import { UserProfilePopover } from "@/components/user-profile-popover"

export function ConversationPanelHeader({
  actions,
  conversation,
  currentUserId,
  online,
  status,
}: {
  actions?: ReactNode
  conversation: ClientConversation
  currentUserId: string
  online?: boolean
  status?: string
}) {
  return (
    <header
      className="flex h-14 shrink-0 items-center justify-between border-b px-5"
      data-testid="conversation-panel-header"
    >
      <div className="flex min-w-0 items-center gap-3 pr-3">
        <ConversationPanelHeaderProfileAvatar
          conversation={conversation}
          currentUserId={currentUserId}
          online={online}
        />
        <div className="flex min-w-0 flex-col justify-center">
          <h2 className="min-w-0 truncate text-sm leading-5 font-medium">
            {conversation.name}
          </h2>
          {conversation.type === "group" && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
              <UsersRound className="size-3" />
              {getGroupMemberCount(conversation)} 人
            </span>
          )}
          {conversation.type === "app" && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
              <Bot className="size-3" />
              {status ? (
                <ConversationStatusIndicator status={status} />
              ) : (
                "应用"
              )}
            </span>
          )}
          {conversation.type === "direct" && (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground">
              <UserRound className="size-3" />
              {status ? (
                <ConversationStatusIndicator status={status} />
              ) : (
                "私聊"
              )}
            </span>
          )}
          {conversation.type === "topic" && (
            <span
              className="inline-flex min-w-0 items-center gap-1 text-xs leading-4 text-muted-foreground"
              title={getTopicTypeLabel(conversation)}
            >
              <MessagesSquare className="size-3 shrink-0" />
              <span className="truncate">
                {getTopicTypeLabel(conversation)}
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        {conversation.type === "group" && (
          <AddGroupMembersDialog conversation={conversation} />
        )}
        {conversation.type !== "topic" && (
          <ConversationAttachmentsDialog conversation={conversation} />
        )}
        {conversation.type !== "topic" && (
          <ConversationInfoDrawer conversationId={conversation.id}>
            <Button
              aria-label="会话设置"
              size="icon-sm"
              title="会话设置"
              type="button"
              variant="ghost"
            >
              <Settings className="size-4" />
            </Button>
          </ConversationInfoDrawer>
        )}
      </div>
    </header>
  )
}

function getGroupMemberCount(conversation: ClientConversation) {
  return conversation.memberCount || conversation.members?.length || 0
}

function getTopicTypeLabel(conversation: ClientConversation) {
  const parentConversationName =
    conversation.topic?.parentConversationName.trim()

  return parentConversationName ? `话题 - ${parentConversationName}` : "话题"
}

function ConversationPanelHeaderProfileAvatar({
  conversation,
  currentUserId,
  online,
}: {
  conversation: ClientConversation
  currentUserId: string
  online?: boolean
}) {
  const avatar = (
    <ConversationPanelHeaderAvatar
      conversation={conversation}
      online={online}
    />
  )

  if (conversation.type === "topic") {
    return avatar
  }

  if (conversation.type === "group") {
    return (
      <GroupProfilePopover conversation={conversation}>
        {avatar}
      </GroupProfilePopover>
    )
  }

  if (conversation.type === "direct") {
    const otherMember = conversation.members?.find(
      (member) => member.type === "user" && member.id !== currentUserId
    )

    if (!otherMember) {
      return avatar
    }

    return (
      <UserProfilePopover
        fallbackProfile={otherMember}
        triggerAriaLabel={`${conversation.name}资料`}
        userId={otherMember.id}
      >
        {avatar}
      </UserProfilePopover>
    )
  }

  const appMember = conversation.members?.find(
    (member) => member.type === "app"
  )
  const appId = appMember?.id ?? conversation.id

  return (
    <AppProfilePopover
      appId={appId}
      fallbackProfile={{
        avatar: appMember?.avatar || conversation.avatar,
        description: "",
        id: appId,
        name: appMember?.name || conversation.name,
        online: online ?? false,
      }}
      triggerAriaLabel={`${conversation.name}资料`}
    >
      {avatar}
    </AppProfilePopover>
  )
}

function ConversationPanelHeaderAvatar({
  conversation,
  online,
}: {
  conversation: ClientConversation
  online?: boolean
}) {
  return (
    <ConversationAvatar
      className="size-9"
      conversation={conversation}
      online={online}
      sourceAvatarClassName="size-5"
    />
  )
}
