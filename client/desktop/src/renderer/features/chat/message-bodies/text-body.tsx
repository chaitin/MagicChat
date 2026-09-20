import { useContext } from "react"
import { MessageMarkdown } from "@/components/message-markdown"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { mentionClassName, parseMentionTemplate } from "@/lib/message-mentions"
import { MentionContext } from "./context"

export function TextBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <span className="break-all whitespace-pre-wrap">
      {parseMentionTemplate(content, resolveLabel).map((part, index) =>
        part.type === "text" ? (
          part.text
        ) : part.targetType === "all" ? (
          <span
            key={`${part.id}-${index}`}
            className={mentionClassName(part.targetType, part.id, currentUserId)}
          >
            {part.label}
          </span>
        ) : (
          <ContactProfilePopover
            key={`${part.targetType}:${part.id}:${index}`}
            type={part.targetType}
            id={part.id}
            fallbackName={part.label.replace(/^@/, "")}
            triggerClassName="align-baseline"
          >
            <span className={mentionClassName(part.targetType, part.id, currentUserId)}>
              {part.label}
            </span>
          </ContactProfilePopover>
        ),
      )}
    </span>
  )
}

export function MarkdownBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <MessageMarkdown
      content={content}
      currentUserId={currentUserId}
      mentionLabelResolver={resolveLabel}
    />
  )
}
