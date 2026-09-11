import * as React from "react"

import { linkifyMessageText } from "@/lib/message-links"

const messageInlineLinkClassName =
  "mx-0.5 break-all font-medium text-(--weui-link) underline-offset-4"

export function MessageInlineLink({
  children,
  href,
}: {
  children: React.ReactNode
  href: string
}) {
  return (
    <a
      className={messageInlineLinkClassName}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  )
}

export function MessageTextWithLinks({ text }: { text: string }) {
  return linkifyMessageText(text).map((part, index) =>
    part.type === "link" ? (
      <MessageInlineLink href={part.href} key={`link-${index}-${part.value}`}>
        {part.value}
      </MessageInlineLink>
    ) : (
      <React.Fragment key={`text-${index}`}>{part.value}</React.Fragment>
    )
  )
}
