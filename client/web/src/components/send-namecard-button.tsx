import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ForwardMessageDialog } from "@/components/conversation/forward-message-dialog"
import { useClientData } from "@/lib/client-data-context"
import {
  contactLink,
  parseContactLink,
  type ContactLinkTarget,
} from "../../../shared/contact-links"

const sendNamecardEvent = "jiying:send-namecard"

export function SendNamecardButton({
  target,
  className = "w-full",
}: {
  target: ContactLinkTarget
  className?: string
}) {
  return (
    <Button
      className={className}
      type="button"
      variant="secondary"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(sendNamecardEvent, { detail: target })
        )
      }
    >
      推荐给好友
    </Button>
  )
}

export function NamecardDialogHost() {
  const { me } = useClientData()
  return <AccountNamecardDialogHost key={me.id} />
}

function AccountNamecardDialogHost() {
  const [target, setTarget] = useState<ContactLinkTarget | null>(null)
  useEffect(() => {
    const open = (event: Event) => {
      try {
        const next = parseContactLink(
          contactLink((event as CustomEvent<ContactLinkTarget>).detail)
        )
        if (next) setTarget(next)
      } catch {
        /* Ignore malformed local requests. */
      }
    }
    window.addEventListener(sendNamecardEvent, open)
    return () => window.removeEventListener(sendNamecardEvent, open)
  }, [])
  return (
    target && (
      <NamecardDialog
        key={`${target.type}:${target.id}`}
        target={target}
        onClose={() => setTarget(null)}
      />
    )
  )
}

function NamecardDialog({
  target,
  onClose,
}: {
  target: ContactLinkTarget
  onClose: () => void
}) {
  const { conversations, sendConversationCard } = useClientData()
  const requestIds = useRef(new Map<string, string>())
  return (
    <ForwardMessageDialog
      conversations={conversations}
      messageCount={1}
      purpose="namecard"
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onComplete={onClose}
      onForward={async (ids) => {
        const conversationId = ids[0]
        if (ids.length !== 1 || !conversationId)
          throw new Error("请选择一个会话")
        let clientMessageId = requestIds.current.get(conversationId)
        if (!clientMessageId) {
          clientMessageId = crypto.randomUUID()
          requestIds.current.set(conversationId, clientMessageId)
        }
        const message = await sendConversationCard(
          conversationId,
          {
            type: "entity_card",
            entityType: target.type,
            entityId: target.id,
          },
          { clientMessageId }
        )
        if (!message) throw new Error("发送名片失败，请重试")
        return {
          sentCount: 1,
          failedCount: 0,
          results: [{ conversationId, status: "sent", messages: [message] }],
        }
      }}
    />
  )
}
