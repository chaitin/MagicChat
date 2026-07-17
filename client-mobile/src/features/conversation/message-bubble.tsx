import { useRef } from "react"
import {
  Avatar,
  Button,
  Card,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type { ServerTarget } from "@/data/query"
import type { ResourceLoadState } from "@/data/resources"
import { MessageBody } from "@/features/conversation/message-body"
import {
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"

export function MessageBubble({
  currentUserId,
  message,
  onAvatarLongPress,
  onAvatarPress,
  onMentionPress,
  onResourceError,
  onResourcePress,
  onVoiceResourcePress,
  resolveMentionLabel,
  resourceStates,
  server,
}: {
  currentUserId: string
  message: PresentedMessage
  onAvatarLongPress?: (sender: EntityReference) => void
  onAvatarPress: (sender: EntityReference) => void
  onMentionPress: (target: EntityReference) => void
  onResourceError: (fileId: string) => void
  onResourcePress: (fileId: string) => void
  onVoiceResourcePress: (fileId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  resourceStates: ReadonlyMap<string, ResourceLoadState>
  server: ServerTarget
}) {
  const didLongPressAvatarRef = useRef(false)

  if (message.role === "system") {
    return (
      <XStack justify="center" px="$5">
        <XStack bg="$backgroundPress" maxW="85%" p="$2" px="$3" rounded="$10">
          <SizableText color="$color10" size="$2" text="center">
            {formatClientMessageBodySummary(message.body, resolveMentionLabel)}
          </SizableText>
        </XStack>
      </XStack>
    )
  }

  const fromMe = message.role === "me"
  const sender = message.sender
  const avatar = sender ? (
    <Button
      aria-label={`查看${fromMe ? "我的" : message.author}资料`}
      chromeless
      height="$3"
      onLongPress={
        onAvatarLongPress
          ? () => {
              didLongPressAvatarRef.current = true
              onAvatarLongPress(sender)
            }
          : undefined
      }
      onPress={() => {
        if (didLongPressAvatarRef.current) {
          didLongPressAvatarRef.current = false
          return
        }
        onAvatarPress(sender)
      }}
      onPressIn={() => {
        didLongPressAvatarRef.current = false
      }}
      p={0}
      width="$3"
    >
      <MessageAvatar
        avatar={message.avatar}
        name={fromMe ? "我" : message.author}
        server={server}
      />
    </Button>
  ) : (
    <MessageAvatar
      avatar={message.avatar}
      name={fromMe ? "我" : message.author}
      server={server}
    />
  )

  return (
    <XStack
      gap="$2"
      items="flex-start"
      justify={fromMe ? "flex-end" : "flex-start"}
      px="$3"
    >
      {!fromMe ? avatar : null}
      <YStack
        gap="$1"
        items={fromMe ? "flex-end" : "flex-start"}
        maxW="82%"
      >
        <XStack gap="$2" items="center">
          <SizableText color="$color10" numberOfLines={1} size="$2">
            {message.author}
          </SizableText>
          {message.time ? (
            <SizableText color="$color10" size="$1">
              {message.time}
            </SizableText>
          ) : null}
        </XStack>

        <Card
          bg={fromMe ? "$teal3" : "$background"}
          rounded="$5"
          borderTopLeftRadius={fromMe ? "$5" : "$1"}
          borderTopRightRadius={fromMe ? "$1" : "$5"}
          borderWidth={0}
          maxW="100%"
          overflow="hidden"
          p="$3"
        >
          {message.replyTo ? (
            <YStack borderColor="$borderColor" borderLeftWidth={2} mb="$2" pl="$2">
              <SizableText fontWeight="600" numberOfLines={1} size="$2">
                {message.replyTo.author}
              </SizableText>
              <Paragraph color="$color10" numberOfLines={2} size="$2">
                {message.replyTo.summary}
              </Paragraph>
            </YStack>
          ) : null}
          <MessageBody
            body={message.body}
            currentUserId={currentUserId}
            onMentionPress={onMentionPress}
            onResourceError={onResourceError}
            onResourcePress={onResourcePress}
            onVoiceResourcePress={onVoiceResourcePress}
            resolveMentionLabel={resolveMentionLabel}
            resourceStates={resourceStates}
            serverUrl={server.url}
          />
        </Card>

        {message.delegatedByName ? (
          <SizableText color="$color10" size="$1">
            由 {message.delegatedByName} 代发
          </SizableText>
        ) : null}
      </YStack>
      {fromMe ? avatar : null}
    </XStack>
  )
}

function MessageAvatar({
  avatar,
  name,
  server,
}: {
  avatar: string
  name: string
  server: ServerTarget
}) {
  return (
    <Avatar rounded="$2" size="$3" theme={name === "我" ? "teal" : undefined}>
      <CachedAvatarImage avatar={avatar} server={server} />
      <Avatar.Fallback bg="$backgroundFocus" items="center" justify="center">
        <SizableText fontWeight="600" size="$2">
          {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
        </SizableText>
      </Avatar.Fallback>
    </Avatar>
  )
}
