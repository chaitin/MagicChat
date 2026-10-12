import {
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  MessagesSquare,
} from "lucide-react-native"
import { memo, useRef, useState } from "react"
import { Alert, Image, Linking, Pressable, View } from "react-native"
import { Text } from "@/components/mi-sans-text"

import { NativeIconButton } from "@/components/buttons/native-icon-button"
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
        <Text selectable style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 23 }}>
          <MessageMentionText
            content={body.content}
            currentUserId={currentUserId}
            onMentionPress={onMentionPress}
            resolveMentionLabel={resolveMentionLabel}
          />
        </Text>
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
      <Pressable
        accessible={false}
        onLongPress={() => {
          didLongPressResourceRef.current = true
          onMessageLongPress()
        }}
        style={{ gap: 7, width: "100%" }}
      >
        <View style={{ alignItems: "center", flexDirection: "row", gap: 13 }}>
          <ThemedIcon color={colors.brand5} icon={FileText} size={22} />
          <Text style={{ color: colors.brand5, flex: 1, fontSize: 15, lineHeight: 23 }}>
            文件 {formatFileSize(body.sizeBytes)}
          </Text>
          <NativeIconButton
            accessibilityLabel={`打开文件 ${body.name}`}
            disabled={isLoading}
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
          >
            {isLoading ? (
              <XGUILoadingIcon color={colors.brand5} size={18} />
            ) : (
              <ThemedIcon color={colors.brand5} icon={Download} size={18} />
            )}
          </NativeIconButton>
        </View>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {body.name}
        </Text>
      </Pressable>
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
      <View style={{ maxWidth: "100%", width: size.width }}>
        {image}
        <View style={{ paddingBottom: flushImage ? 13 : undefined, paddingHorizontal: flushImage ? 13 : undefined, paddingTop: 7 }}>
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
            <Text style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 23 }}>
              <MessageMentionText
                content={body.caption}
                currentUserId={currentUserId}
                onMentionPress={onMentionPress}
                resolveMentionLabel={resolveMentionLabel}
              />
            </Text>
          )}
        </View>
      </View>
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
      <View style={{ maxWidth: "100%", width: "100%" }}>
        {video}
        <View style={{ paddingBottom: flushImage ? 13 : undefined, paddingHorizontal: flushImage ? 13 : undefined, paddingTop: 7 }}>
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
            <Text style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 23 }}>
              <MessageMentionText
                content={body.caption}
                currentUserId={currentUserId}
                onMentionPress={onMentionPress}
                resolveMentionLabel={resolveMentionLabel}
              />
            </Text>
          )}
        </View>
      </View>
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
    return <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 23 }}>该消息已被撤回</Text>
  }

  if (body.type === "unsupported") {
    return (
      <Text style={{ color: colors.textPlaceholder, fontSize: 15, lineHeight: 23 }}>
        暂不支持查看该消息
      </Text>
    )
  }

  return (
    <Text style={{ color: colors.textPrimary, fontSize: 15, lineHeight: 23, textAlign: "center" }}>
      {formatClientMessageBodySummary(body, resolveMentionLabel)}
    </Text>
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
        resizeMode="cover"
        source={{ uri }}
        style={{ height: size.height, opacity: status === "ready" ? 1 : 0, width: size.width }}
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
    <Pressable
      accessibilityLabel={error ? "图片加载失败" : "图片正在加载"}
      onLongPress={onLongPress}
      onPress={onPress}
      style={{ alignItems: "center", backgroundColor: colors.background4, borderBottomLeftRadius: captioned ? 0 : 7, borderBottomRightRadius: captioned ? 0 : 7, borderTopLeftRadius: 7, borderTopRightRadius: 7, height: size.height, justifyContent: "center", left: absolute ? 0 : undefined, overflow: "hidden", position: absolute ? "absolute" : "relative", top: absolute ? 0 : undefined, width: size.width }}
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
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
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
      style={{ backgroundColor: "transparent", gap: 7, width: "100%" }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
        <ThemedIcon color={accentColor} icon={icon} size={18} />
        <Text numberOfLines={1} style={{ color: accentColor, flex: 1, fontSize: 15, fontWeight: "600", lineHeight: 23 }}>
          {title}
        </Text>
      </View>
      {description.trim() ? (
        <Text numberOfLines={4} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
          {description}
        </Text>
      ) : null}
    </Pressable>
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
    <Pressable accessible={false} onLongPress={onLongPress} style={{ gap: 7, width: "100%" }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 13 }}>
        <ThemedIcon color={colors.brand5} icon={MessagesSquare} size={22} />
        <Text style={{ color: colors.brand5, flex: 1, fontSize: 15, lineHeight: 23 }}>聊天记录</Text>
      </View>
      <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
        {body.itemCount} 条 - {firstSummary}
      </Text>
    </Pressable>
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
