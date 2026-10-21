import StudentCardIcon from "@hugeicons/core-free-icons/dist/esm/StudentCardIcon"
import { useEffect, useRef, useState } from "react"
import Svg, { Path } from "react-native-svg"
import { sendConversationEntityCardMessage } from "@/data/messages/messages-api"
import { messageManager } from "@/data/messages/message-manager"
import { createAuthenticatedScopeKey } from "@/data/server-key"
import { ForwardMessageSheet } from "@/features/conversation/forward-message-sheet"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { XGUIListItem, useXGUITheme, useXGUIToast } from "@/xgui"
import type { EntityReference } from "@/domain/entities/entity-profile"

export function SendNamecardAction({ target }: { target: EntityReference }) {
  const session = useAuthenticatedSession()
  const scopeKey = JSON.stringify(createAuthenticatedScopeKey(session))
  return (
    <AccountSendNamecardAction key={`${scopeKey}:${target.type}:${target.id}`} target={target} />
  )
}

function AccountSendNamecardAction({ target }: { target: EntityReference }) {
  const session = useAuthenticatedSession()
  const { conversations } = useClientData()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const [open, setOpen] = useState(false)
  const [mountedSheet, setMountedSheet] = useState(false)
  const active = useRef(true)
  const messageIds = useRef(new Map<string, string>())
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  return (
    <>
      <XGUIListItem
        accessibilityLabel="推荐给好友"
        centerContent
        leading={
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" accessible={false}>
            {StudentCardIcon.map(([, attributes]) => (
              <Path
                key={attributes.key}
                d={attributes.d}
                stroke={colors.link}
                strokeWidth={1}
                strokeLinecap={attributes.strokeLinecap}
                strokeLinejoin={attributes.strokeLinejoin}
              />
            ))}
          </Svg>
        }
        link
        minHeight={60}
        onPress={() => {
          messageIds.current.clear()
          setMountedSheet(true)
          setOpen(true)
        }}
        title="推荐给好友"
        titleFontSize={16}
      />
      {mountedSheet && (
        <ForwardMessageSheet
          key={`${target.type}:${target.id}`}
          conversations={conversations}
          purpose="namecard"
          source={null}
          server={session}
          open={open}
          onRequestClose={() => setOpen(false)}
          onAnimationComplete={(nextOpen) => {
            if (!nextOpen) setMountedSheet(false)
          }}
          onForward={async (ids) => {
            if (ids.length !== 1) return false
            const conversationId = ids[0]
            try {
              let clientMessageId = messageIds.current.get(conversationId)
              if (!clientMessageId) {
                clientMessageId =
                  globalThis.crypto?.randomUUID?.() ??
                  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
                    const value = Math.floor(Math.random() * 16)
                    return (char === "x" ? value : (value & 3) | 8).toString(16)
                  })
                messageIds.current.set(conversationId, clientMessageId)
              }
              const message = await sendConversationEntityCardMessage(session, conversationId, {
                clientMessageId,
                entityType: target.type,
                entityId: target.id,
              })
              await messageManager.writeMessages(session, [message])
              if (!active.current) return false
              toast.show({ duration: 1_000, message: "名片已发送", type: "success" })
              return true
            } catch (error) {
              if (active.current)
                toast.show({
                  duration: 2_000,
                  message: error instanceof Error ? error.message : "发送名片失败，请重试",
                  type: "error",
                })
              return false
            }
          }}
        />
      )}
    </>
  )
}
