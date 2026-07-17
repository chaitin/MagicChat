import { Fragment } from "react"
import { Text } from "tamagui"

import type { EntityReference } from "@/domain/entities/entity-profile"
import {
  parseMessageMentionTemplate,
  type MessageMentionLabelResolver,
} from "@/domain/messages/message-mentions"

export function MessageMentionText({
  content,
  currentUserId,
  onMentionPress,
  resolveMentionLabel,
}: {
  content: string
  currentUserId: string
  onMentionPress: (target: EntityReference) => void
  resolveMentionLabel: MessageMentionLabelResolver
}) {
  const parts = parseMessageMentionTemplate(content, resolveMentionLabel)

  return parts.map((part, index) => {
    if (part.type === "text") {
      return <Fragment key={`text:${index}`}>{part.text}</Fragment>
    }

    const mentionsCurrentUser =
      part.targetType === "all" ||
      (part.targetType === "user" &&
        part.id.toLowerCase() === currentUserId.toLowerCase())
    const target =
      part.targetType === "all"
        ? null
        : ({ id: part.id, type: part.targetType } satisfies EntityReference)

    return (
      <Text
        color={mentionsCurrentUser ? "$orange10" : "$blue10"}
        fontWeight="600"
        key={`${part.targetType}:${part.id}:${index}`}
        onPress={target ? () => onMentionPress(target) : undefined}
      >
        {part.label}
      </Text>
    )
  })
}
