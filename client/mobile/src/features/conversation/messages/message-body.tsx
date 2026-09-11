import {
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  MessagesSquare,
} from "lucide-react-native"
import { memo, useRef, useState } from "react"
import { Alert, Linking, Pressable } from "react-native"
import {
  Button,
  Card,
  Image,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ClientMessageBody } from "@/core/models"
import type { ResourceLoadState } from "@/data/resources"
import {
  forgetLoadedAttachmentImage,
  hasLoadedAttachmentImage,
  markAttachmentImageLoaded,
} from "@/data/resources/attachment-resource-memory"
import type { EntityReference } from "@/domain/entities/entity-profile"
import {
  formatClientMessageBodySummary,
  formatFileSize,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-presenter"
import { MarkdownMessage } from "@/features/conversation/messages/markdown-message"
import { MessageChart } from "@/features/conversation/messages/message-chart"
import { CollapsibleMessageContent } from "@/features/conversation/messages/collapsible-message-content"
import { MessageMentionText } from "@/features/conversation/messages/message-mention-text"
import { MessageVideo } from "@/features/conversation/messages/message-video"
import { VoiceMessagePlayer } from "@/features/conversation/voice/voice-message-player"
import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

export const MessageBody = memo(function MessageBody({
  body,
  bubbleTone,
  currentUserId,
  flushImage,
  onImagePress,
  onMentionPress,
  onMessageLongPress,
  onResourceError,
  onResourcePress,
  onVoiceResourcePress,
  resolveMentionLabel,
  roundVideoBottom,
  resourceStates,
  serverUrl,
}: {
  body: ClientMessageBody
  bubbleTone: "mine" | "other"
  currentUserId: string
  flushImage: boolean
  onImagePress: (fileId: string) => void
  onMentionPress: (target: EntityReference) => void
  onMessageLongPress: () => void
  onResourceError: (fileId: string) => void
  onResourcePress: (fileId: string) => void
  onVoiceResourcePress: (fileId: string) => void
  resolveMentionLabel: MessageMentionLabelResolver
  roundVideoBottom: boolean
  resourceStates: ReadonlyMap<string, ResourceLoadState>
  serverUrl: string
}) {
  const { colors } = useXGUITheme()
  const retriedImageIds = useRef(new Set<string>())
  const didLongPressResourceRef = useRef(false)

  if (body.type === "text") {
    return (
      <CollapsibleMessageContent
        tone={bubbleTone}
        variant="text"
      >
        <Paragraph color={colors.textPrimary} selectable size="$4">
          <MessageMentionText
            content={body.content}
            currentUserId={currentUserId}
            onMentionPress={onMentionPress}
            resolveMentionLabel={resolveMentionLabel}
          />
        </Paragraph>
      </CollapsibleMessageContent>
    )
  }

  if (body.type === "markdown") {
    return (
      <CollapsibleMessageContent
        tone={bubbleTone}
        variant="markdown"
      >
        <MarkdownMessage
          content={body.content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
          serverUrl={serverUrl}
        />
      </CollapsibleMessageContent>
    )
  }

  if (body.type === "link") {
    return (
      <MessageLinkCard
        accent="brand5"
        description={body.url}
        icon={LinkIcon}
        onLongPress={onMessageLongPress}
        onPress={() => void openExternalUrl(body.url)}
        title={body.title || "链接"}
      />
    )
  }

  if (body.type === "card") {
    return (
      <MessageLinkCard
        accent="link"
        description={body.description}
        icon={ExternalLink}
        onLongPress={onMessageLongPress}
        onPress={body.url.trim() ? () => void openExternalUrl(body.url) : undefined}
        title={body.title}
      />
    )
  }

  if (body.type === "chart") {
    return <MessageChart chart={body} onLongPress={onMessageLongPress} />
  }

  if (body.type === "file") {
    const state = resourceStates.get(body.fileId)
    const isLoading = state?.status === "loading"
    return (
      <YStack
        gap="$2"
        onLongPress={() => {
          didLongPressResourceRef.current = true
          onMessageLongPress()
        }}
        width="100%"
      >
        <XStack gap="$3" items="center">
          <ThemedIcon color={colors.brand5} icon={FileText} size={22} />
          <SizableText color={colors.brand5} flex={1} size="$4">
            文件 {formatFileSize(body.sizeBytes)}
          </SizableText>
          <Button
            accessibilityLabel={`打开文件 ${body.name}`}
            chromeless
            circular
            disabled={isLoading}
            icon={
              isLoading ? (
                <XGUILoadingIcon color={colors.brand5} size={18} />
              ) : (
                <ThemedIcon
                  color={colors.brand5}
                  icon={Download}
                  size={18}
                />
              )
            }
            onLongPress={() => {
              didLongPressResourceRef.current = true
              onMessageLongPress()
            }}
            onPress={() => {
              if (didLongPressResourceRef.current) {
                didLongPressResourceRef.current = false
                return
              }
              onResourcePress(body.fileId)
            }}
            onPressIn={() => {
              didLongPressResourceRef.current = false
            }}
            size="$3"
          />
        </XStack>
        <SizableText
          color={colors.textSecondary}
          numberOfLines={1}
          size="$3"
        >
          {body.name}
        </SizableText>
      </YStack>
    )
  }

  if (body.type === "image") {
    const state = resourceStates.get(body.fileId)
    const size = getImageDisplaySize(body.width, body.height)
    const image = (
      <MessageImageThumbnail
        captioned={Boolean(body.caption)}
        onError={() => {
          if (retriedImageIds.current.has(body.fileId)) return
          retriedImageIds.current.add(body.fileId)
          onResourceError(body.fileId)
        }}
        onLongPress={onMessageLongPress}
        onPress={() => onImagePress(body.fileId)}
        size={size}
        state={state}
      />
    )

    if (!body.caption) return image

    return (
      <YStack maxW="100%" width={size.width}>
        {image}
        <YStack
          pb={flushImage ? "$3" : undefined}
          pt="$2"
          px={flushImage ? "$3" : undefined}
        >
          {body.captionType === "markdown" ? (
            <MarkdownMessage
              content={body.caption}
              currentUserId={currentUserId}
              onMentionPress={onMentionPress}
              resolveMentionLabel={resolveMentionLabel}
              selectable={false}
              serverUrl={serverUrl}
            />
          ) : (
            <Paragraph color={colors.textPrimary} size="$4">
              <MessageMentionText
                content={body.caption}
                currentUserId={currentUserId}
                onMentionPress={onMentionPress}
                resolveMentionLabel={resolveMentionLabel}
              />
            </Paragraph>
          )}
        </YStack>
      </YStack>
    )
  }

  if (body.type === "video") {
    const video = (
      <MessageVideo
        onLongPress={onMessageLongPress}
        onReload={() => onResourceError(body.fileId)}
        roundedBottom={roundVideoBottom}
        state={resourceStates.get(body.fileId)}
      />
    )
    if (!body.caption) return video
    return (
      <YStack maxW="100%" width="100%">
        {video}
        <YStack
          pb={flushImage ? "$3" : undefined}
          pt="$2"
          px={flushImage ? "$3" : undefined}
        >
          {body.captionType === "markdown" ? (
            <MarkdownMessage
              content={body.caption}
              currentUserId={currentUserId}
              onMentionPress={onMentionPress}
              resolveMentionLabel={resolveMentionLabel}
              selectable={false}
              serverUrl={serverUrl}
            />
          ) : (
            <Paragraph color={colors.textPrimary} size="$4">
              <MessageMentionText
                content={body.caption}
                currentUserId={currentUserId}
                onMentionPress={onMentionPress}
                resolveMentionLabel={resolveMentionLabel}
              />
            </Paragraph>
          )}
        </YStack>
      </YStack>
    )
  }

  if (body.type === "voice") {
    const state = resourceStates.get(body.fileId)
    return (
      <VoiceMessagePlayer
        durationMS={body.durationMS}
        fileId={body.fileId}
        onLongPress={onMessageLongPress}
        onResourceError={onResourceError}
        onResourceRequest={onVoiceResourcePress}
        state={state}
        transcript={body.transcript}
      />
    )
  }

  if (body.type === "forward_bundle") {
    return (
      <ForwardBundleBody
        body={body}
        onLongPress={onMessageLongPress}
        resolveMentionLabel={resolveMentionLabel}
      />
    )
  }

  if (body.type === "revoked") {
    return <Paragraph color="$gray11" size="$4">该消息已被撤回</Paragraph>
  }

  if (body.type === "unsupported") {
    return (
      <Paragraph color={colors.textPlaceholder} size="$4">
        暂不支持查看该消息
      </Paragraph>
    )
  }

  return (
    <Paragraph size="$4" text="center">
      {formatClientMessageBodySummary(body, resolveMentionLabel)}
    </Paragraph>
  )
})

function MessageImageThumbnail({
  captioned,
  onError,
  onLongPress,
  onPress,
  size,
  state,
}: {
  captioned: boolean
  onError: () => void
  onLongPress: () => void
  onPress: () => void
  size: { height: number; width: number }
  state: ResourceLoadState | undefined
}) {
  const resource = state?.resource

  if (!resource) {
    return (
      <MessageImageStatus
        captioned={captioned}
        error={state?.status === "error"}
        onLongPress={onLongPress}
        onPress={state?.status === "error" ? onPress : undefined}
        size={size}
      />
    )
  }

  return (
    <LoadedMessageImage
      captioned={captioned}
      onError={onError}
      onLongPress={onLongPress}
      onPress={onPress}
      size={size}
      uri={resource.uri}
    />
  )
}

function LoadedMessageImage({
  captioned,
  onError,
  onLongPress,
  onPress,
  size,
  uri,
}: {
  captioned: boolean
  onError: () => void
  onLongPress: () => void
  onPress: () => void
  size: { height: number; width: number }
  uri: string
}) {
  const didLongPressRef = useRef(false)
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    () => (hasLoadedAttachmentImage(uri) ? "ready" : "loading")
  )

  return (
    <Pressable
      accessibilityLabel={status === "ready" ? "查看图片" : undefined}
      disabled={status !== "ready"}
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      onPress={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false
          return
        }
        onPress()
      }}
      onPressIn={() => {
        didLongPressRef.current = false
      }}
      style={{
        borderBottomLeftRadius: captioned ? 0 : 7,
        borderBottomRightRadius: captioned ? 0 : 7,
        borderTopLeftRadius: 7,
        borderTopRightRadius: 7,
        height: size.height,
        overflow: "hidden",
        width: size.width,
      }}
    >
      <Image
        height={size.height}
        objectFit="cover"
        onError={() => {
          forgetLoadedAttachmentImage(uri)
          setStatus("error")
          onError()
        }}
        onLoad={() => {
          markAttachmentImageLoaded(uri)
          setStatus("ready")
        }}
        onLoadStart={() => {
          if (!hasLoadedAttachmentImage(uri)) setStatus("loading")
        }}
        opacity={status === "ready" ? 1 : 0}
        pointerEvents="none"
        src={uri}
        width={size.width}
      />
      {status !== "ready" ? (
        <MessageImageStatus
          absolute
          captioned={captioned}
          error={status === "error"}
          size={size}
        />
      ) : null}
    </Pressable>
  )
}

function MessageImageStatus({
  absolute = false,
  captioned,
  error,
  onLongPress,
  onPress,
  size,
}: {
  absolute?: boolean
  captioned: boolean
  error: boolean
  onLongPress?: () => void
  onPress?: () => void
  size: { height: number; width: number }
}) {
  const { colors } = useXGUITheme()

  return (
    <YStack
      accessibilityLabel={error ? "图片加载失败" : "图片正在加载"}
      bg={colors.background4}
      borderBottomLeftRadius={captioned ? 0 : 7}
      borderBottomRightRadius={captioned ? 0 : 7}
      borderTopLeftRadius={7}
      borderTopRightRadius={7}
      height={size.height}
      items="center"
      justify="center"
      l={absolute ? 0 : undefined}
      onLongPress={onLongPress}
      onPress={onPress}
      overflow="hidden"
      position={absolute ? "absolute" : "relative"}
      t={absolute ? 0 : undefined}
      width={size.width}
    />
  )
}

function MessageLinkCard({
  accent,
  description,
  icon,
  onLongPress,
  onPress,
  title,
}: {
  accent: "brand5" | "link"
  description: string
  icon: typeof LinkIcon
  onLongPress: () => void
  onPress?: () => void
  title: string
}) {
  const { colors } = useXGUITheme()
  const accentColor = accent === "brand5" ? colors.brand5 : colors.link
  const didLongPressRef = useRef(false)

  return (
    <Card
      bg="transparent"
      borderWidth={0}
      gap="$2"
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      onPress={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false
          return
        }
        onPress?.()
      }}
      onPressIn={() => {
        didLongPressRef.current = false
      }}
      p={0}
      width="100%"
    >
      <XStack gap="$2" items="center">
        <ThemedIcon color={accentColor} icon={icon} size={18} />
        <SizableText
          color={accentColor}
          flex={1}
          fontWeight="600"
          numberOfLines={1}
          size="$4"
        >
          {title}
        </SizableText>
      </XStack>
      {description.trim() ? (
        <Paragraph
          color={colors.textSecondary}
          numberOfLines={4}
          size="$3"
        >
          {description}
        </Paragraph>
      ) : null}
    </Card>
  )
}

function ForwardBundleBody({
  body,
  onLongPress,
  resolveMentionLabel,
}: {
  body: Extract<ClientMessageBody, { type: "forward_bundle" }>
  onLongPress: () => void
  resolveMentionLabel: MessageMentionLabelResolver
}) {
  const { colors } = useXGUITheme()
  const firstItem = body.items[0]
  const firstSummary = firstItem
    ? firstItem.summary.trim() ||
      formatClientMessageBodySummary(firstItem.body, resolveMentionLabel)
    : "暂无消息"

  return (
    <YStack
      gap="$2"
      onLongPress={onLongPress}
      width="100%"
    >
      <XStack gap="$3" items="center">
        <ThemedIcon color={colors.brand5} icon={MessagesSquare} size={22} />
        <SizableText color={colors.brand5} flex={1} size="$4">
          聊天记录
        </SizableText>
      </XStack>
      <Paragraph color={colors.textSecondary} numberOfLines={2} size="$3">
        {body.itemCount} 条 - {firstSummary}
      </Paragraph>
    </YStack>
  )
}

function getImageDisplaySize(width?: number, height?: number) {
  const displayWidth = 240
  if (!width || !height) return { height: 180, width: displayWidth }
  return {
    height: Math.min(300, Math.max(120, (displayWidth * height) / width)),
    width: displayWidth,
  }
}

async function openExternalUrl(url: string) {
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert("无法打开", "这个链接暂时无法打开。")
  }
}
