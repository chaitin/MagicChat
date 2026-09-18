import type { DesktopMessageBody } from "../../../shared/account-data"
import type { MentionLabelResolver } from "@/lib/message-mentions"
import { MediaContext, MentionContext } from "./message-bodies/context"
import { MessageBodyContent } from "./message-bodies/message-body-content"

export function MessageBodyRenderer({
  body,
  targetId,
  currentUserId,
  mentionLabelResolver,
  conversationName,
  flushMedia = false,
}: {
  body: DesktopMessageBody
  targetId: string
  currentUserId: string
  mentionLabelResolver: MentionLabelResolver
  conversationName: string
  flushMedia?: boolean
}) {
  return (
    <MediaContext.Provider value={{ targetId, conversationName }}>
      <MentionContext.Provider value={{ currentUserId, resolveLabel: mentionLabelResolver }}>
        <MessageBodyContent
          body={body}
          targetId={targetId}
          flushMedia={flushMedia}
          collapseLongContent
        />
      </MentionContext.Provider>
    </MediaContext.Provider>
  )
}
