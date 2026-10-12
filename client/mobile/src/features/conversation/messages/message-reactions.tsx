import { Fragment, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"

import type {
  ClientMessageReaction,
  ClientMessageReactionUser,
} from "@/core/models"
import { useXGUITheme } from "@/xgui"

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
  const { colors } = useXGUITheme()
  const [pendingTexts, setPendingTexts] = useState<ReadonlySet<string>>(
    new Set()
  )

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
    <View
      style={[
        styles.container,
        { justifyContent: align === "end" ? "flex-end" : "flex-start" },
      ]}
    >
      {reactions.map((reaction) => {
        const canToggle =
          Boolean(onSetReaction) && (canAdd || reaction.reactedByMe)
        const pending = pendingTexts.has(reaction.text)

        return (
          <View
            key={reaction.text}
            style={[
              styles.chip,
              {
                backgroundColor: colors.secondaryBackground,
                opacity: !canToggle || pending ? 0.7 : 1,
              },
            ]}
          >
            <Pressable
              accessibilityLabel={`${reaction.reactedByMe ? "取消" : "加入"}表情 ${reaction.text}`}
              accessibilityRole="button"
              disabled={!canToggle || pending}
              hitSlop={4}
              onPress={() => void toggleReaction(reaction)}
              onPressIn={(event) => event.stopPropagation()}
              style={styles.inlineControl}
            >
              <Text style={[styles.reactionText, { color: colors.textPrimary }]}>
                {reaction.text}
              </Text>
            </Pressable>
            <ReactionParticipants
              onUserPress={onUserPress}
              reaction={reaction}
            />
          </View>
        )
      })}
    </View>
  )
}

function ReactionParticipants({
  onUserPress,
  reaction,
}: {
  onUserPress: (user: ClientMessageReactionUser) => void
  reaction: ClientMessageReaction
}) {
  const { colors } = useXGUITheme()

  if (reaction.users.length === 0) {
    return (
      <Text style={[styles.countText, { color: colors.textPrimary }]}>
        {reaction.count}
      </Text>
    )
  }

  return (
    <View style={styles.participants}>
      {reaction.users.map((user, index) => (
        <Fragment key={user.id}>
          {index > 0 ? (
            <Text style={[styles.participantText, { color: colors.textPrimary }]}>
              、
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel={`查看${user.name}资料`}
            accessibilityRole="button"
            hitSlop={4}
            onPress={() => onUserPress(user)}
            onPressIn={(event) => event.stopPropagation()}
            style={styles.inlineControl}
          >
            <Text
              numberOfLines={1}
              style={[styles.participantText, { color: colors.textPrimary }]}
            >
              {user.name}
            </Text>
          </Pressable>
        </Fragment>
      ))}
      {reaction.count > reaction.users.length ? (
        <Text style={[styles.participantText, { color: colors.textPrimary }]}>
          {`等 ${reaction.count} 人`}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    maxWidth: "100%",
  },
  chip: {
    alignItems: "center",
    borderRadius: 5,
    flexDirection: "row",
    height: 20,
    maxWidth: "100%",
    overflow: "hidden",
    paddingHorizontal: 4,
  },
  reactionText: { fontSize: 13, lineHeight: 18 },
  countText: { fontSize: 12, lineHeight: 16, marginLeft: 2 },
  participantText: { fontSize: 12, lineHeight: 16 },
  inlineControl: {
    height: 20,
    justifyContent: "center",
  },
  participants: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    marginLeft: 2,
    overflow: "hidden",
  },
})
