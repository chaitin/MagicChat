import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/motion/button/base"
import { ForwardMessageDialog } from "@/features/chat/components/forward-message-dialog"
import type { DesktopConversation } from "../../shared/account-data"
import {
  contactLink,
  parseContactLink,
  type ContactLinkTarget,
} from "../../../../shared/contact-links"

const sendEvent = "jiying:send-namecard"
export const openContactEvent = "jiying:open-contact"

export function SendNamecardButton({
  targetId,
  target,
}: {
  targetId: string
  target: ContactLinkTarget
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      onClick={() =>
        window.dispatchEvent(new CustomEvent(sendEvent, { detail: { targetId, target } }))
      }
    >
      推荐给好友
    </Button>
  )
}

export function NamecardDialogHost({
  targetId,
  theme,
  conversations,
  onOpenContact,
}: {
  targetId: string
  theme: "light" | "dark"
  conversations: DesktopConversation[]
  onOpenContact: (target: ContactLinkTarget) => void
}) {
  const [target, setTarget] = useState<ContactLinkTarget | null>(null)
  const requestIds = useRef(new Map<string, string>())
  useEffect(() => {
    const receive = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ targetId: string; target: ContactLinkTarget }>)
          .detail
        if (detail.targetId !== targetId) return
        const next = parseContactLink(contactLink(detail.target))
        if (!next) return
        if (event.type === sendEvent) {
          requestIds.current.clear()
          setTarget(next)
        } else onOpenContact(next)
      } catch {
        /* Ignore malformed local requests. */
      }
    }
    window.addEventListener(sendEvent, receive)
    window.addEventListener(openContactEvent, receive)
    return () => {
      window.removeEventListener(sendEvent, receive)
      window.removeEventListener(openContactEvent, receive)
    }
  }, [targetId, onOpenContact])
  return (
    target && (
      <ForwardMessageDialog
        key={`${target.type}:${target.id}`}
        targetId={targetId}
        theme={theme}
        conversations={conversations}
        purpose="namecard"
        messageCount={1}
        onClose={() => setTarget(null)}
        onComplete={() => setTarget(null)}
        onForward={async (ids) => {
          const conversationId = ids[0]
          if (ids.length !== 1 || !conversationId) throw new Error("请选择一个会话")
          let clientMessageId = requestIds.current.get(conversationId)
          if (!clientMessageId) {
            clientMessageId = crypto.randomUUID()
            requestIds.current.set(conversationId, clientMessageId)
          }
          const result = await window.desktop!.accountData.sendRichMessage({
            targetId,
            conversationId,
            clientMessageId,
            body: { type: "entity_card", entityType: target.type, entityId: target.id },
          })
          if (!result.ok) throw new Error(result.error.message)
          return {
            sentCount: 1,
            failedCount: 0,
            results: [{ conversationId, status: "sent", messages: result.data }],
          }
        }}
      />
    )
  )
}
