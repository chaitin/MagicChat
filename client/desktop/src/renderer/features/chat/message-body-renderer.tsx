import type { DesktopMessageBody, DesktopMessageChoiceState } from "../../../shared/account-data"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import { MediaContext, MentionContext } from "./message-bodies/context"
import { MessageBodyContent } from "./message-bodies/message-body-content"

export function MessageBodyRenderer({
  body,
  targetId,
  currentUserId,
  mentionLabelResolver,
  conversationName,
  messageId,
  choice,
  showChoiceResponseCounts = false,
  onChoiceRespond,
  onReeditRevoked,
  flushMedia = false,
  flushInteractiveCard = false,
  initialExpanded = false,
  onExpand,
}: {
  body: DesktopMessageBody
  targetId: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  conversationName: string
  messageId?: string
  choice?: DesktopMessageChoiceState
  showChoiceResponseCounts?: boolean
  onChoiceRespond?: (optionIds: string[]) => Promise<void>
  onReeditRevoked?: () => void
  flushMedia?: boolean
  flushInteractiveCard?: boolean
  initialExpanded?: boolean
  onExpand?: () => void
}) {
  return (
    <MediaContext.Provider value={{ targetId, conversationName }}>
      <MentionContext.Provider value={{ currentUserId, resolveLabel: mentionLabelResolver }}>
        <MessageBodyContent
          body={body}
          targetId={targetId}
          messageId={messageId}
          choice={choice}
          showChoiceResponseCounts={showChoiceResponseCounts}
          onChoiceRespond={onChoiceRespond}
          onReeditRevoked={onReeditRevoked}
          flushMedia={flushMedia}
          flushInteractiveCard={flushInteractiveCard}
          collapseLongContent
          initialExpanded={initialExpanded}
          onExpand={onExpand}
        />
      </MentionContext.Provider>
    </MediaContext.Provider>
  )
}
