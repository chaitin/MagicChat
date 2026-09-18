import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { FlashIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { AppRail, SectionPlaceholder, type AppSection } from "./components/app-navigation"
import { ChatHeader } from "./components/chat-header"
import { ConversationSidebar } from "./components/conversation-sidebar"
import { MessageComposer } from "./components/message-composer"
import { MessageList } from "./components/message-list"
import { useAttachmentSender } from "./hooks/use-attachment-sender"
import { useChatData } from "./hooks/use-chat-data"
import { SendFileMessageDialog } from "./send-file-message-dialog"
import { SendMediaMessageDialog } from "./send-media-message-dialog"
import type { ServerCatalog } from "../../../shared/auth"
import type { ThemePreference } from "../../../shared/desktop"

export function ChatPage({
  targetId,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  onThemeChange,
  onSignOut,
  onCatalogChange,
}: {
  targetId: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  theme: ThemePreference
  catalog: ServerCatalog
  isPreview: boolean
  onThemeChange: (theme: ThemePreference) => void
  onSignOut: () => Promise<boolean>
  onCatalogChange: (catalog: ServerCatalog) => void
}) {
  const { showToast } = useAnimatedToast()
  const [activeSection, setActiveSection] = useState<AppSection>("chat")
  const [draft, setDraft] = useState("")
  const [markdownMode, setMarkdownMode] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const pendingComposerCursorRef = useRef<number | null>(null)
  const {
    conversations,
    messages,
    selected,
    selectedId,
    loadingConversations,
    loadingMessages,
    loadingBeforeMessages,
    pendingReactionKeys,
    historyRef,
    setSelectedId,
    resolveMentionLabel,
    setMessageReaction,
    applySentMessages,
    sendTextMessage,
    retryMessage,
    loadBeforeMessages,
  } = useChatData({ targetId, userId, userName })

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const composer = composerRef.current
      if (!composer) return
      composer.focus()
      const cursor = pendingComposerCursorRef.current
      if (cursor !== null) {
        composer.setSelectionRange(cursor, cursor)
        pendingComposerCursorRef.current = null
      }
    })
  }, [])

  const {
    selectingFile,
    sendingFile,
    fileDialogOpen,
    pendingFile,
    selectingMedia,
    sendingMedia,
    mediaCaption,
    pendingImage,
    pendingVideo,
    setMediaCaption,
    selectFile,
    sendPendingFile,
    selectMedia,
    sendPendingImage,
    sendPendingVideo,
    closeFileDialog,
    closeImageDialog,
    closeVideoDialog,
  } = useAttachmentSender({
    targetId,
    selected,
    focusComposer,
    onMessages: applySentMessages,
  })

  const sendDraft = useCallback(() => {
    const content = draft.trim()
    if (!content) return
    const bodyType = markdownMode ? "markdown" : "text"
    setDraft("")
    focusComposer()
    sendTextMessage(content, bodyType)
  }, [draft, focusComposer, markdownMode, sendTextMessage])

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.nativeEvent.isComposing
      ) {
        return
      }
      event.preventDefault()
      sendDraft()
    },
    [sendDraft],
  )

  const insertExpression = useCallback(
    (value: string) => {
      const composer = composerRef.current
      const selectionStart = composer?.selectionStart ?? draft.length
      const selectionEnd = composer?.selectionEnd ?? selectionStart
      const nextDraft = `${draft.slice(0, selectionStart)}${value}${draft.slice(selectionEnd)}`
      pendingComposerCursorRef.current = selectionStart + value.length
      setDraft(nextDraft)
    },
    [draft],
  )

  useEffect(() => {
    setDraft("")
    pendingComposerCursorRef.current = null
    if (selectedId) focusComposer()
  }, [focusComposer, selectedId])

  return (
    <main className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <AppRail
        targetId={targetId}
        userId={userId}
        userName={userName}
        userEmail={userEmail}
        resolvedTheme={resolvedTheme}
        theme={theme}
        catalog={catalog}
        isPreview={isPreview}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        onSignOut={onSignOut}
        onThemeChange={onThemeChange}
        onCatalogChange={onCatalogChange}
      />
      {activeSection === "chat" ? (
        <div className="grid min-w-0 flex-1 grid-cols-[19rem_minmax(0,1fr)]">
          <ConversationSidebar
            conversations={conversations}
            loading={loadingConversations}
            selectedId={selectedId}
            targetId={targetId}
            resolvedTheme={resolvedTheme}
            mentionLabelResolver={resolveMentionLabel}
            onSelect={setSelectedId}
          />

          <section className="flex min-h-0 min-w-0 flex-col bg-card" aria-label="聊天区域">
            {selected ? (
              <>
                <ChatHeader
                  conversation={selected}
                  targetId={targetId}
                  resolvedTheme={resolvedTheme}
                  onPendingFeature={(label) => showPendingFeature(showToast, label)}
                />

                <MessageList
                  messages={messages}
                  loading={loadingMessages}
                  loadingBefore={loadingBeforeMessages}
                  historyRef={historyRef}
                  targetId={targetId}
                  userId={userId}
                  userName={userName}
                  resolvedTheme={resolvedTheme}
                  conversationName={selected.name}
                  mentionLabelResolver={resolveMentionLabel}
                  pendingReactionKeys={pendingReactionKeys}
                  onReachTop={() => void loadBeforeMessages()}
                  onSetReaction={setMessageReaction}
                  onRetryMessage={retryMessage}
                  onPendingFeature={(label) => showPendingFeature(showToast, label)}
                />

                <MessageComposer
                  composerRef={composerRef}
                  draft={draft}
                  markdownMode={markdownMode}
                  selectingFile={selectingFile}
                  sendingFile={sendingFile}
                  selectingMedia={selectingMedia}
                  sendingMedia={sendingMedia}
                  onDraftChange={setDraft}
                  onKeyDown={handleComposerKeyDown}
                  onMarkdownChange={(pressed) => {
                    setMarkdownMode(pressed)
                    focusComposer()
                  }}
                  onRestoreFocus={focusComposer}
                  onInsertExpression={insertExpression}
                  onSelectFile={selectFile}
                  onSelectMedia={(category) => void selectMedia(category)}
                  onSend={sendDraft}
                />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xgui-background-2">
                <span className="flex size-32 items-center justify-center rounded-full bg-xgui-background-1">
                  <HugeiconsIcon icon={FlashIcon} className="size-16" aria-hidden />
                </span>
              </div>
            )}
          </section>
        </div>
      ) : (
        <SectionPlaceholder section={activeSection} />
      )}
      <SendMediaMessageDialog
        category="image"
        caption={mediaCaption}
        conversationName={pendingImage?.conversationName ?? ""}
        open={Boolean(pendingImage)}
        resourceUrl={pendingImage?.prepared.resourceUrl ?? ""}
        sending={sendingMedia === "image"}
        onCaptionChange={setMediaCaption}
        onConfirm={sendPendingImage}
        onOpenChange={(open) => {
          if (!open) closeImageDialog()
        }}
      />
      <SendMediaMessageDialog
        category="video"
        caption={mediaCaption}
        conversationName={pendingVideo?.conversationName ?? ""}
        open={Boolean(pendingVideo)}
        resourceUrl={pendingVideo?.selected.resourceUrl ?? ""}
        sending={sendingMedia === "video"}
        onCaptionChange={setMediaCaption}
        onConfirm={sendPendingVideo}
        onOpenChange={(open) => {
          if (!open) closeVideoDialog()
        }}
      />
      <SendFileMessageDialog
        conversationName={pendingFile?.conversationName ?? ""}
        file={pendingFile?.file ?? null}
        open={fileDialogOpen}
        sending={sendingFile}
        onConfirm={sendPendingFile}
        onOpenChange={(open) => {
          if (!open) closeFileDialog()
        }}
      />
    </main>
  )
}

function showPendingFeature(
  showToast: ReturnType<typeof useAnimatedToast>["showToast"],
  label: string,
) {
  showToast({ status: "info", title: `${label}功能将在下一阶段接入` })
}
