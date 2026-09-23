import { Fragment, useContext, type MouseEvent } from "react"
import { ContactProfilePopover } from "@/components/avatar/contact-profile-popover"
import { MessageMarkdown } from "@/components/message-markdown"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { linkifyMessageText } from "@/lib/message-links"
import { mentionClassName, parseMentionTemplate } from "@/lib/message-mentions"
import { MentionContext } from "./context"

export function TextBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <span className="inline-block max-w-[30rem] break-all whitespace-pre-wrap">
      {parseMentionTemplate(content, resolveLabel).map((part, index) =>
        part.type === "text" ? (
          <MessageTextWithLinks key={`text-${index}`} text={part.text} />
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

function MessageTextWithLinks({ text }: { text: string }) {
  const { showToast } = useAnimatedToast()

  async function openLink(event: MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault()
    if (typeof window.desktop?.openWebLink !== "function") {
      showToast({ status: "error", title: "请重启桌面端后再打开链接" })
      return
    }
    try {
      const result = await window.desktop.openWebLink(url)
      if (!result.ok) showToast({ status: "error", title: result.error.message })
    } catch {
      showToast({ status: "error", title: "无法打开链接" })
    }
  }

  return linkifyMessageText(text).map((part, index) =>
    part.type === "link" ? (
      <a
        key={`link-${index}-${part.value}`}
        href={part.href}
        rel="noreferrer"
        className="cursor-pointer text-xgui-link no-underline visited:text-xgui-link hover:text-xgui-link hover:no-underline"
        onClick={(event) => void openLink(event, part.href)}
      >
        {part.value}
      </a>
    ) : (
      <Fragment key={`text-${index}`}>{part.value}</Fragment>
    ),
  )
}

export function MarkdownBody({ content }: { content: string }) {
  const { currentUserId, resolveLabel } = useContext(MentionContext)
  return (
    <div className="max-w-[30rem]">
      <MessageMarkdown
        content={content}
        currentUserId={currentUserId}
        mentionLabelResolver={resolveLabel}
      />
    </div>
  )
}
