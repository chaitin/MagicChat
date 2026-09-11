import { Check } from "lucide-react-native"
import { useRef, useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { Paragraph, YStack } from "tamagui"

import type {
  ClientChoiceMessageBody,
  ClientMessageChoiceState,
} from "@/core/models"
import type { EntityReference } from "@/domain/entities/entity-profile"
import type { MessageMentionLabelResolver } from "@/domain/messages/message-presenter"
import {
  isMessageChoiceAnswered,
  updateMessageChoiceDraft,
} from "@/domain/messages/message-choices"
import { MarkdownMessage } from "@/features/conversation/messages/markdown-message"
import { MessageMentionText } from "@/features/conversation/messages/message-mention-text"
import { XGUIBadge, XGUIButton, useXGUITheme, useXGUIToast } from "@/xgui"

export function MessageChoice({
  body,
  canRespond,
  choice,
  currentUserId,
  onLongPress,
  onMentionPress,
  onRespond,
  resolveMentionLabel,
  serverUrl,
  showResponseCounts,
}: {
  body: ClientChoiceMessageBody
  canRespond: boolean
  choice?: ClientMessageChoiceState
  currentUserId: string
  onLongPress: () => void
  onMentionPress: (target: EntityReference) => void
  onRespond?: (optionIds: string[]) => Promise<void>
  resolveMentionLabel: MessageMentionLabelResolver
  serverUrl: string
  showResponseCounts: boolean
}) {
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const didLongPressRef = useRef(false)
  const [draftOptionIds, setDraftOptionIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const answered = isMessageChoiceAnswered(choice)
  const selectedOptionIds = answered
    ? (choice?.myOptionIds ?? [])
    : draftOptionIds
  const disabled = !canRespond || answered || submitting
  const hasSubmittableSelection =
    canRespond && Boolean(onRespond) && selectedOptionIds.length > 0
  const countsByOptionId = new Map(
    choice?.options.map((option) => [option.id, option.responseCount]) ?? []
  )

  function selectSingle(optionId: string) {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    if (!disabled) {
      setDraftOptionIds((current) =>
        updateMessageChoiceDraft(body, current, optionId)
      )
    }
  }

  function toggleMultiple(optionId: string) {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    if (disabled) return
    setDraftOptionIds((current) =>
      updateMessageChoiceDraft(body, current, optionId)
    )
  }

  async function submitResponse() {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    if (
      !onRespond ||
      answered ||
      submitting ||
      selectedOptionIds.length === 0
    ) {
      return
    }
    setSubmitting(true)
    try {
      await onRespond(selectedOptionIds)
    } catch (error: unknown) {
      toast.show({ message: error instanceof Error ? error.message : "提交选择失败", modal: false, type: "text", duration: 1_000 })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <YStack
      gap="$3"
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      width="100%"
    >
      {body.contentType === "markdown" ? (
        <MarkdownMessage
          content={body.content}
          currentUserId={currentUserId}
          onMentionPress={onMentionPress}
          resolveMentionLabel={resolveMentionLabel}
          selectable={false}
          serverUrl={serverUrl}
        />
      ) : (
        <Paragraph size="$4">
          <MessageMentionText
            content={body.content}
            currentUserId={currentUserId}
            onMentionPress={onMentionPress}
            resolveMentionLabel={resolveMentionLabel}
          />
        </Paragraph>
      )}

      <YStack
        borderColor={colors.separator}
        rounded={8}
        borderWidth={StyleSheet.hairlineWidth}
        overflow="hidden"
      >
        {body.options.map((option, index) => (
          <ChoiceOptionRow
            count={countsByOptionId.get(option.id) ?? 0}
            disabled={disabled}
            key={option.id}
            label={option.label}
            onLongPress={() => {
              didLongPressRef.current = true
              onLongPress()
            }}
            onPress={() =>
              body.selection === "single"
                ? selectSingle(option.id)
                : toggleMultiple(option.id)
            }
            onPressIn={() => {
              didLongPressRef.current = false
            }}
            selected={selectedOptionIds.includes(option.id)}
            separator={index > 0}
            showResponseCount={showResponseCounts}
            type={body.selection === "single" ? "radio" : "checkbox"}
          />
        ))}
      </YStack>

      {!answered ? (
        <YStack gap="$3">
          <XGUIButton
            accessibilityLabel="提交选择"
            disabled={!hasSubmittableSelection || submitting}
            loading={submitting}
            onLongPress={() => {
              didLongPressRef.current = true
              onLongPress()
            }}
            onPress={() => void submitResponse()}
            onPressIn={() => {
              didLongPressRef.current = false
            }}
            style={styles.submitButton}
            textStyle={styles.submitButtonText}
          >
            提交
          </XGUIButton>
        </YStack>
      ) : null}
    </YStack>
  )
}

function ChoiceOptionRow({
  count,
  disabled,
  label,
  onLongPress,
  onPress,
  onPressIn,
  selected,
  separator,
  showResponseCount,
  type,
}: {
  count: number
  disabled: boolean
  label: string
  onLongPress: () => void
  onPress: () => void
  onPressIn: () => void
  selected: boolean
  separator: boolean
  showResponseCount: boolean
  type: "checkbox" | "radio"
}) {
  const { colors } = useXGUITheme()

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole={type}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
      style={styles.optionPressable}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.optionRow,
            pressed ? { backgroundColor: colors.background1 } : null,
            disabled && !selected ? styles.optionDisabled : null,
          ]}
        >
          {separator ? (
            <View
              pointerEvents="none"
              style={[
                styles.optionSeparator,
                { backgroundColor: colors.separator },
              ]}
            />
          ) : null}
          <ChoiceSelectionControl selected={selected} type={type} />
          <Text style={[styles.optionLabel, { color: colors.textPrimary }]}>
            {label}
          </Text>
          {showResponseCount ? (
            <XGUIBadge
              accessibilityLabel={`${count} 人选择`}
              backgroundColor={colors.foreground4}
              count={count}
              style={styles.optionCount}
              textColor={colors.foreground0Half}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

function ChoiceSelectionControl({
  selected,
  type,
}: {
  selected: boolean
  type: "checkbox" | "radio"
}) {
  const { colors } = useXGUITheme()
  return (
    <View
      style={[
        styles.selectionControl,
        {
          backgroundColor: selected ? colors.brand : "transparent",
          borderColor: selected ? colors.brand : colors.textPlaceholder,
        },
      ]}
    >
      {selected && type === "checkbox" ? (
        <Check color={colors.textOnColor} size={15} strokeWidth={2.4} />
      ) : null}
      {selected && type === "radio" ? (
        <View
          style={[styles.radioDot, { backgroundColor: colors.textOnColor }]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  optionCount: {
    marginLeft: 12,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  optionLabel: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    minWidth: 0,
  },
  optionPressable: {
    alignSelf: "stretch",
  },
  optionRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 12,
    position: "relative",
  },
  optionSeparator: {
    height: StyleSheet.hairlineWidth,
    left: 46,
    position: "absolute",
    right: 12,
    top: 0,
  },
  radioDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  selectionControl: {
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginRight: 12,
    width: 22,
  },
  submitButton: {
    height: 40,
    minHeight: 40,
    paddingVertical: 0,
    width: "100%",
  },
  submitButtonText: {
    fontSize: 16,
    lineHeight: 22,
  },
})
