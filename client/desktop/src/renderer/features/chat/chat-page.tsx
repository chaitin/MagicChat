import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react"
import { FlashIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { ContactProfileProvider } from "@/components/avatar/contact-profile-popover"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { AppRail, SectionPlaceholder, type AppSection } from "./components/app-navigation"
import { ClientAppDialog } from "../contacts/client-app-dialog"
import { ContactsPage } from "../contacts/contacts-page"
import { ChatHeader } from "./components/chat-header"
import { ConversationSidebar } from "./components/conversation-sidebar"
import { CreateGroupConversationDialog } from "./components/create-group-conversation-dialog"
import { MessageComposer } from "./components/message-composer"
import { MessageList } from "./components/message-list"
import { useAttachmentSender } from "./hooks/use-attachment-sender"
import { useChatData } from "./hooks/use-chat-data"
import { SendFileMessageDialog } from "./send-file-message-dialog"
import { SendMediaMessageDialog } from "./send-media-message-dialog"
import type { DesktopContactDirectory } from "../../../shared/account-data"
import type { ServerCatalog } from "../../../shared/auth"
import type { ThemePreference } from "../../../shared/desktop"

export function ChatPage({
  targetId,
  serverUrl,
  userId,
  userName,
  userEmail,
  resolvedTheme,
  theme,
  catalog,
  isPreview,
  onThemeChange,
  onSignOut,
  onRequestQuit,
  onCatalogChange,
  onRefresh,
}: {
  targetId: string
  serverUrl: string
  userId: string
  userName: string
  userEmail: string
  resolvedTheme: "light" | "dark"
  theme: ThemePreference
  catalog: ServerCatalog
  isPreview: boolean
  onThemeChange: (theme: ThemePreference) => void
  onSignOut: () => Promise<boolean>
  onRequestQuit: () => void
  onCatalogChange: (catalog: ServerCatalog) => void
  onRefresh: () => void
}) {
  const { showToast } = useAnimatedToast()
  const [activeSection, setActiveSection] = useState<AppSection>("chat")
  const [actionDialog, setActionDialog] = useState<"group" | "app" | null>(null)
  const [actionDirectory, setActionDirectory] = useState<DesktopContactDirectory | null>(null)
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
    importingFile,
    importFile,
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

  const openProfileConversation = useCallback(
    async (type: "user" | "app", id: string) => {
      const result = await window.desktop!.accountData.openContactConversation({
        targetId,
        type,
        id,
      })
      if (!result.ok) throw new Error(result.error.message)
      setSelectedId(result.data.id)
      setActiveSection("chat")
    },
    [setSelectedId, targetId],
  )

  const openActionDialog = useCallback(
    async (dialog: "group" | "app") => {
      if (!window.desktop) return
      try {
        const result = await window.desktop.accountData.getContacts(targetId)
        if (!result.ok) throw new Error(result.error.message)
        setActionDirectory(result.data)
        setActionDialog(dialog)
      } catch (error) {
        showToast({
          status: "error",
          title: error instanceof Error ? error.message : "无法读取通讯录",
        })
      }
    },
    [showToast, targetId],
  )

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
        onRequestQuit={onRequestQuit}
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
            onCreateGroup={() => void openActionDialog("group")}
            onCreateApp={() => void openActionDialog("app")}
            onRefresh={onRefresh}
          />

          <section className="flex min-h-0 min-w-0 flex-col bg-card" aria-label="聊天区域">
            <ContactProfileProvider
              targetId={targetId}
              currentUserId={userId}
              currentUserName={userName}
              currentUserEmail={userEmail}
              theme={resolvedTheme}
              onOpenConversation={openProfileConversation}
            >
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
                    importingFile={importingFile}
                    onFiles={(files) => {
                      if (files.length !== 1) {
                        showToast({ status: "error", title: "请每次发送一个文件" })
                        return
                      }
                      void importFile(files[0])
                    }}
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
            </ContactProfileProvider>
          </section>
        </div>
      ) : activeSection === "contacts" ? (
        <ContactsPage
          targetId={targetId}
          serverUrl={serverUrl}
          userId={userId}
          organizationName={
            catalog.servers.find((server) => server.id === catalog.activeServerId)?.name ?? "通讯录"
          }
          resolvedTheme={resolvedTheme}
          onOpenConversation={(conversationId) => {
            setSelectedId(conversationId)
            setActiveSection("chat")
          }}
          onCreateGroup={() => void openActionDialog("group")}
          onCreateApp={() => void openActionDialog("app")}
          onRefresh={onRefresh}
        />
      ) : (
        <SectionPlaceholder section={activeSection} />
      )}
      {actionDialog === "group" && actionDirectory && (
        <CreateGroupConversationDialog
          targetId={targetId}
          currentUserId={userId}
          theme={resolvedTheme}
          contacts={actionDirectory.users}
          apps={actionDirectory.apps}
          onClose={() => setActionDialog(null)}
          onCreated={(conversation) => {
            setActionDialog(null)
            setSelectedId(conversation.id)
            setActiveSection("chat")
          }}
        />
      )}
      {actionDialog === "app" && actionDirectory && (
        <ClientAppDialog
          mode="create"
          targetId={targetId}
          serverUrl={serverUrl}
          currentUserId={userId}
          theme={resolvedTheme}
          users={actionDirectory.users}
          credentials={null}
          onClose={() => setActionDialog(null)}
          onChanged={() => undefined}
          onAvatarChanged={() => undefined}
        />
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
