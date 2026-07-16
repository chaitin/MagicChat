import {
  Avatar,
  Button,
  Card,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import type { EntityReference } from "@/domain/entities/entity-profile"
import { MessageBody } from "@/features/conversation/message-body"
import {
  formatClientMessageBodySummary,
  type MessageMentionLabelResolver,
  type PresentedMessage,
} from "@/domain/messages/message-presenter"
import { resolveServerAssetUrl } from "@/lib/server-asset-url"

export function MessageBubble({
  fileUrls,
  fileUrlsLoading,
  message,
  onAvatarPress,
  resolveMentionLabel,
  serverUrl,
}: {
  fileUrls: ReadonlyMap<string, string>
  fileUrlsLoading: boolean
  message: PresentedMessage
  onAvatarPress: (sender: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
}) {
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
      onPress={() => onAvatarPress(sender)}
      p={0}
      width="$3"
    >
      <MessageAvatar
        avatar={message.avatar}
        name={fromMe ? "我" : message.author}
        serverUrl={serverUrl}
      />
    </Button>
  ) : (
    <MessageAvatar
      avatar={message.avatar}
      name={fromMe ? "我" : message.author}
      serverUrl={serverUrl}
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
          bg={fromMe ? "$teal3" : "$backgroundPress"}
          borderColor={fromMe ? "$teal6" : "$borderColor"}
          rounded="$5"
          borderTopLeftRadius={fromMe ? "$5" : "$1"}
          borderTopRightRadius={fromMe ? "$1" : "$5"}
          borderWidth={1}
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
            fileUrls={fileUrls}
            fileUrlsLoading={fileUrlsLoading}
            resolveMentionLabel={resolveMentionLabel}
            serverUrl={serverUrl}
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
  serverUrl,
}: {
  avatar: string
  name: string
  serverUrl: string
}) {
  const avatarUrl = resolveServerAssetUrl(serverUrl, avatar)

  return (
    <Avatar rounded="$2" size="$3" theme={name === "我" ? "teal" : undefined}>
      {avatarUrl ? <Avatar.Image src={avatarUrl} /> : null}
      <Avatar.Fallback bg="$backgroundFocus" items="center" justify="center">
        <SizableText fontWeight="600" size="$2">
          {Array.from(name.trim())[0]?.toUpperCase() ?? "?"}
        </SizableText>
      </Avatar.Fallback>
    </Avatar>
  )
}
