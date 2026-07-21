import { Fragment, useState } from "react"
import { Pressable, StyleSheet } from "react-native"
import { SizableText, XStack } from "tamagui"

import type {
  ClientMessageReaction,
  ClientMessageReactionUser,
} from "@/data/models"

export function MessageReactionChips({
  align,
  canAdd,
  onSetReaction,
  onUserPress,
  reactions,
}: {
  align: "start" | "end"
  canAdd: boolean
  onSetReaction?: (text: string, reacted: boolean) => Promise<void>
  onUserPress: (user: ClientMessageReactionUser) => void
  reactions: ClientMessageReaction[]
}) {
  const [pendingTexts, setPendingTexts] = useState<ReadonlySet<string>>(
    new Set()
  )
  const [pressedText, setPressedText] = useState("")

  if (reactions.length === 0) return null

  async function toggleReaction(reaction: ClientMessageReaction) {
    const text = reaction.text
    if (
      !onSetReaction ||
      (!canAdd && !reaction.reactedByMe) ||
      pendingTexts.has(text)
    ) {
      return
    }

    setPendingTexts((current) => new Set(current).add(text))
    try {
      await onSetReaction(text, !reaction.reactedByMe)
    } catch {
      // The screen owns the user-facing error message.
    } finally {
      setPendingTexts((current) => {
        const next = new Set(current)
        next.delete(text)
        return next
      })
    }
  }

  return (
    <XStack
      flexWrap="wrap"
      gap={6}
      justify={align === "end" ? "flex-end" : "flex-start"}
      maxW="100%"
    >
      {reactions.map((reaction) => {
        const canToggle =
          Boolean(onSetReaction) && (canAdd || reaction.reactedByMe)
        const pending = pendingTexts.has(reaction.text)
        const pressed = pressedText === reaction.text

        return (
          <XStack
            bg={
              pressed
                ? reaction.reactedByMe
                  ? "$color4"
                  : "$color2"
                : reaction.reactedByMe
                  ? "$color3"
                  : "$backgroundPress"
            }
            height={20}
            items="center"
            key={reaction.text}
            maxW="100%"
            opacity={!canToggle || pending ? 0.7 : 1}
            overflow="hidden"
            px={4}
            rounded={5}
          >
            <Pressable
              accessibilityLabel={`${reaction.reactedByMe ? "取消" : "加入"}表情 ${reaction.text}`}
              accessibilityRole="button"
              disabled={!canToggle || pending}
              hitSlop={4}
              onPress={() => void toggleReaction(reaction)}
              onPressIn={(event) => {
                event.stopPropagation()
                setPressedText(reaction.text)
              }}
              onPressOut={() => setPressedText("")}
              style={styles.inlineControl}
            >
              <SizableText lineHeight={18} size="$2">
                {reaction.text}
              </SizableText>
            </Pressable>
            <ReactionParticipants
              onUserPress={onUserPress}
              reaction={reaction}
            />
          </XStack>
        )
      })}
    </XStack>
  )
}

function ReactionParticipants({
  onUserPress,
  reaction,
}: {
  onUserPress: (user: ClientMessageReactionUser) => void
  reaction: ClientMessageReaction
}) {
  if (reaction.users.length === 0) {
    return (
      <SizableText color="$color10" lineHeight={16} ml={2} size="$1">
        {reaction.count}
      </SizableText>
    )
  }

  return (
    <XStack
      items="center"
      ml={2}
      overflow="hidden"
      style={styles.participants}
    >
      {reaction.users.map((user, index) => (
        <Fragment key={user.id}>
          {index > 0 ? (
            <SizableText color="$color10" lineHeight={16} size="$1">
              、
            </SizableText>
          ) : null}
          <Pressable
            accessibilityLabel={`查看${user.name}资料`}
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => onUserPress(user)}
            onPressIn={(event) => event.stopPropagation()}
            style={styles.inlineControl}
          >
            <SizableText
              color="$color10"
              lineHeight={16}
              numberOfLines={1}
              size="$1"
            >
              {user.name}
            </SizableText>
          </Pressable>
        </Fragment>
      ))}
      {reaction.count > reaction.users.length ? (
        <SizableText color="$color10" lineHeight={16} size="$1">
          {`等 ${reaction.count} 人`}
        </SizableText>
      ) : null}
    </XStack>
  )
}

const styles = StyleSheet.create({
  inlineControl: {
    height: 20,
    justifyContent: "center",
  },
  participants: {
    flexShrink: 1,
  },
})
