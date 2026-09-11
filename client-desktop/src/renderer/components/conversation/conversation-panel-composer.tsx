import * as React from "react"
import {
  ImageIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  ScanLine,
  Send,
  Smile,
  UsersRound,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { useLocale } from "@/components/locale-provider"
import type { ScreenshotConversationResult } from "@shared/screenshot-contract"
import { getAvatarInitial } from "@/lib/avatar"
import { cn } from "@/lib/utils"
import {
  dismissScreenshotPermissionToast,
  showScreenshotStartError,
} from "@/lib/screenshot-start-error"
import {
  type ClientConversation,
  type ClientMessage,
  type ImageCaptionType,
} from "@/lib/client-data-api"
import {
  compressImageForMessage,
  imageMessageMaxBytes,
  isAcceptedImageMessageFile,
} from "@/lib/image-message"
import type { ConversationDraftMention } from "@/lib/conversation-drafts"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import { useDesktopSettings } from "@/hooks/use-desktop-settings"
import { acceleratorMatchesKeyboardEvent } from "@/lib/shortcut-recorder"
import { DEFAULT_SEND_MESSAGE_SHORTCUT } from "@shared/shortcut-contract"
import {
  createDraftMentionTemplate,
  createMentionCandidates,
  filterMentionCandidates,
  getClipboardImageFile,
  getMentionTrigger,
  getVisibleMentionIndex,
  insertTextareaText,
  isImeCompositionKeyEvent,
  syncDraftMentions,
  type MentionCandidate,
  type MentionTrigger,
} from "@/lib/conversation-composer"
import { type ExpressionItem } from "@/components/expression-picker"
import { ExpressionPickerPopover } from "@/components/expression-picker-popover"
import { VoiceInputDialog } from "@/components/conversation/voice-input-dialog"
import { MarkdownIcon } from "@/components/icons/markdown-icon"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SendFileMessageDialog } from "@/components/send-file-message-dialog"
import { SendImageMessageDialog } from "@/components/send-image-message-dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Toggle } from "@/components/ui/toggle"
import type {
  ConversationPanelComposerHandle,
  ConversationPanelMentionTarget,
  ConversationPanelReplyTarget,
} from "@/lib/conversation-panel-types"
import { getFileMessageUploadError } from "@/lib/file-message"

type ScreenshotImportState = Readonly<{
  controller: AbortController
  id: number
}>

export const ConversationPanelComposer = React.forwardRef<
  ConversationPanelComposerHandle,
  {
    conversation: ClientConversation
    draft: string
    draftMentions: ConversationDraftMention[]
    replyTarget: ConversationPanelReplyTarget | null
    onCancelReply: () => void
    onDraftBlur?: () => void
    onDraftFocus?: () => void
    onDraftChange: (draft: string, mentions: ConversationDraftMention[]) => void
    onSendFile: (file: File) => Promise<ClientMessage | null>
    onSendImage: (
      image: File,
      caption: string,
      captionType: ImageCaptionType,
    ) => Promise<ClientMessage | null>
    onSendVoice: (voice: VoiceMessageRecording) => Promise<ClientMessage | null>
    onRichTextModeChange: (richTextMode: boolean) => void
    onSendMessage: (content?: string) => Promise<boolean>
    richTextMode: boolean
    sending: boolean
  }
>(function ConversationPanelComposer(
  {
    conversation,
    draft,
    draftMentions,
    replyTarget,
    onCancelReply,
    onDraftBlur,
    onDraftFocus,
    onDraftChange,
    onSendFile,
    onSendImage,
    onSendVoice,
    onRichTextModeChange,
    onSendMessage,
    richTextMode,
    sending,
  },
  ref,
) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const imageInputRef = React.useRef<HTMLInputElement | null>(null)
  const mentionOptionRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const previousSendingRef = React.useRef(sending)
  const shouldFocusAfterSendingRef = React.useRef(false)
  const sendInFlightRef = React.useRef(false)
  const conversationIdRef = React.useRef(conversation.id)
  conversationIdRef.current = conversation.id
  const draftEditRevisionRef = React.useRef(0)
  const draftRef = React.useRef({ mentions: draftMentions, text: draft })
  draftRef.current = { mentions: draftMentions, text: draft }
  const [expressionPickerOpen, setExpressionPickerOpen] = React.useState(false)
  const [fileDialogOpen, setFileDialogOpen] = React.useState(false)
  const [imageDialogOpen, setImageDialogOpen] = React.useState(false)
  const [imagePreparing, setImagePreparing] = React.useState(false)
  const [voiceDialogOpen, setVoiceDialogOpen] = React.useState(false)
  const [mentionTrigger, setMentionTrigger] = React.useState<MentionTrigger | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0)
  const settings = useDesktopSettings()
  const sendMessageShortcut = settings?.sendMessageShortcut ?? DEFAULT_SEND_MESSAGE_SHORTCUT
  const { t } = useLocale()
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null)
  const [imageCaption, setImageCaption] = React.useState("")
  const screenshotImportRef = React.useRef<ScreenshotImportState | undefined>(undefined)
  const screenshotImportIdRef = React.useRef(0)
  const screenshotStartingRef = React.useRef(false)
  const imagePreparationIdRef = React.useRef(0)
  const currentConversationIdRef = React.useRef(conversation.id)
  const mentionCandidates = React.useMemo(
    () =>
      conversation.type === "group" || conversation.topic?.parentConversationType === "group"
        ? createMentionCandidates(conversation.members ?? [])
        : [],
    [conversation.members, conversation.topic?.parentConversationType, conversation.type],
  )
  const filteredMentionCandidates = React.useMemo(
    () => filterMentionCandidates(mentionCandidates, mentionTrigger?.query ?? ""),
    [mentionCandidates, mentionTrigger?.query],
  )

  const handleScreenshotCompleted = React.useEffectEvent((result: ScreenshotConversationResult) => {
    if (result.conversationId !== conversation.id) return
    screenshotImportRef.current?.controller.abort()
    const importState = {
      controller: new AbortController(),
      id: ++screenshotImportIdRef.current,
    }
    screenshotImportRef.current = importState
    void fetch(result.resourceUrl, { signal: importState.controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("composer.screenshotExpired"))
        const blob = await response.blob()
        if (blob.type !== "image/png" || blob.size === 0)
          throw new Error(t("composer.screenshotInvalid"))
        if (!isCurrentScreenshotImport(importState, result.conversationId)) return
        await prepareSelectedImage(
          new File([blob], result.fileName, { lastModified: Date.now(), type: "image/png" }),
          { conversationId: result.conversationId, importState },
        )
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        if (!isCurrentScreenshotImport(importState, result.conversationId)) return
        toast.error(error instanceof Error ? error.message : t("composer.addScreenshotError"))
      })
      .finally(() => {
        if (screenshotImportRef.current?.id === importState.id)
          screenshotImportRef.current = undefined
      })
  })

  React.useEffect(() => {
    currentConversationIdRef.current = conversation.id
    screenshotImportRef.current?.controller.abort()
    screenshotImportRef.current = undefined
    imagePreparationIdRef.current += 1
    setImagePreparing(false)
    const screenshot = window.desktop?.screenshot
    return screenshot ? screenshot.subscribeCompleted(handleScreenshotCompleted) : undefined
  }, [conversation.id])

  React.useEffect(
    () => () => {
      screenshotImportRef.current?.controller.abort()
      imagePreparationIdRef.current += 1
    },
    [],
  )

  function isCurrentScreenshotImport(
    importState: ScreenshotImportState,
    conversationId: string,
  ): boolean {
    return (
      !importState.controller.signal.aborted &&
      screenshotImportRef.current?.id === importState.id &&
      currentConversationIdRef.current === conversationId
    )
  }

  React.useImperativeHandle(ref, () => ({
    focus() {
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    focusAtEnd() {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      })
    },
    insertMention(target) {
      insertMentionTarget(target)
    },
    openDroppedFile(file) {
      if (sending || imagePreparing) {
        return
      }

      if (isAcceptedImageMessageFile(file)) {
        void prepareSelectedImage(file)
        return
      }

      prepareSelectedFile(file)
    },
  }))

  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  React.useEffect(() => {
    if (!mentionTrigger) {
      return
    }

    const visibleSelectedIndex = getVisibleMentionIndex(
      selectedMentionIndex,
      filteredMentionCandidates.length,
    )

    mentionOptionRefs.current[visibleSelectedIndex]?.scrollIntoView({
      block: "nearest",
    })
  }, [filteredMentionCandidates.length, mentionTrigger, selectedMentionIndex])

  React.useEffect(() => {
    if (!replyTarget) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [replyTarget])

  React.useEffect(() => {
    const wasSending = previousSendingRef.current
    previousSendingRef.current = sending

    if (sending || !wasSending || !shouldFocusAfterSendingRef.current) {
      return
    }

    shouldFocusAfterSendingRef.current = false
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.focus()
  }, [sending])

  function handleDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const nextDraft = event.target.value
    const cursor = event.target.selectionStart
    const nextMentions = syncDraftMentions(draftMentions, draft, nextDraft)

    updateDraftFromUser(nextDraft, nextMentions)
    updateMentionTrigger(nextDraft, cursor)
  }

  function updateDraftFromUser(nextDraft: string, nextMentions: ConversationDraftMention[]) {
    draftEditRevisionRef.current += 1
    onDraftChange(nextDraft, nextMentions)
  }

  function updateMentionTrigger(value: string, cursor: number) {
    if (
      (conversation.type !== "group" && conversation.topic?.parentConversationType !== "group") ||
      mentionCandidates.length === 0
    ) {
      setMentionTrigger(null)
      setSelectedMentionIndex(0)
      return
    }

    setMentionTrigger(getMentionTrigger(value, cursor))
    setSelectedMentionIndex(0)
  }

  async function handleSendMessage() {
    const submitted = draftRef.current
    if (!submitted.text.trim() || sendInFlightRef.current) return
    const submittedConversationId = conversation.id
    const submittedRevision = draftEditRevisionRef.current
    shouldFocusAfterSendingRef.current = true
    sendInFlightRef.current = true
    setMentionTrigger(null)
    setSelectedMentionIndex(0)
    draftRef.current = { mentions: [], text: "" }
    onDraftChange("", [])
    let accepted = false
    try {
      accepted = await onSendMessage(createDraftMentionTemplate(submitted.text, submitted.mentions))
    } finally {
      sendInFlightRef.current = false
      if (
        !accepted &&
        conversationIdRef.current === submittedConversationId &&
        draftEditRevisionRef.current === submittedRevision &&
        draftRef.current.text === "" &&
        draftRef.current.mentions.length === 0
      ) {
        draftRef.current = submitted
        onDraftChange(submitted.text, submitted.mentions)
      }
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isImeCompositionKeyEvent(event)) {
      return
    }

    if (mentionTrigger && filteredMentionCandidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedMentionIndex(
          (currentIndex) => (currentIndex + 1) % filteredMentionCandidates.length,
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedMentionIndex(
          (currentIndex) =>
            (currentIndex - 1 + filteredMentionCandidates.length) %
            filteredMentionCandidates.length,
        )
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMentionTrigger(null)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        insertMentionCandidate(
          filteredMentionCandidates[
            getVisibleMentionIndex(selectedMentionIndex, filteredMentionCandidates.length)
          ] ?? filteredMentionCandidates[0],
        )
        return
      }
    }

    if (
      sendMessageShortcut &&
      acceleratorMatchesKeyboardEvent(sendMessageShortcut, event.nativeEvent)
    ) {
      // 命中当前发送预设时发送，其余 Enter 组合统一用于换行。
      event.preventDefault()
      if (!sending) handleSendMessage()
      return
    }

    if (event.key !== "Enter") {
      return
    }

    event.preventDefault()
    if (!sending) {
      insertTextareaText(event.currentTarget, "\n", handleTextareaValueChange)
    }
  }

  function handleTextareaValueChange(value: string, cursor?: number) {
    updateDraftFromUser(value, syncDraftMentions(draftMentions, draft, value))
    updateMentionTrigger(value, cursor ?? value.length)
  }

  function insertMentionCandidate(candidate: MentionCandidate | undefined) {
    if (!candidate) {
      return
    }

    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? draft.length
    const trigger = getMentionTrigger(draft, cursor)

    insertMentionTarget(candidate, {
      end: cursor,
      start: trigger?.start ?? cursor,
    })
  }

  function insertMentionTarget(
    target: ConversationPanelMentionTarget,
    range?: {
      end: number
      start: number
    },
  ) {
    const textarea = textareaRef.current
    const selectionStart = range?.start ?? textarea?.selectionStart ?? draft.length
    const selectionEnd = range?.end ?? textarea?.selectionEnd ?? selectionStart

    const mentionText = `@${target.label}`
    const insertedText = `${mentionText} `
    const nextDraft = draft.slice(0, selectionStart) + insertedText + draft.slice(selectionEnd)
    const nextMention: ConversationDraftMention = {
      end: selectionStart + mentionText.length,
      id: target.id,
      label: target.label,
      start: selectionStart,
      targetType: target.targetType,
    }

    const nextMentions = [
      ...syncDraftMentions(
        draftMentions.filter(
          (mention) => mention.end <= selectionStart || mention.start >= selectionEnd,
        ),
        draft,
        nextDraft,
      ),
      nextMention,
    ].sort((mentionA, mentionB) => mentionA.start - mentionB.start)

    updateDraftFromUser(nextDraft, nextMentions)
    setMentionTrigger(null)
    setSelectedMentionIndex(0)

    window.requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return
      }

      const nextCursor = selectionStart + insertedText.length
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function handleExpressionSelect(item: ExpressionItem) {
    if (sending) {
      return
    }

    const textarea = textareaRef.current

    if (!textarea) {
      handleTextareaValueChange(draft + item.value)
      setExpressionPickerOpen(false)
      return
    }

    insertTextareaText(textarea, item.value, handleTextareaValueChange)
    setExpressionPickerOpen(false)
    window.requestAnimationFrame(() => {
      textarea.focus()
    })
  }

  function handleFileButtonClick() {
    fileInputRef.current?.click()
  }

  function handleImageButtonClick() {
    imageInputRef.current?.click()
  }

  async function handleScreenshotButtonClick() {
    if (sending || imagePreparing || screenshotStartingRef.current) return
    const screenshot = window.desktop?.screenshot
    if (!screenshot) {
      toast.error(t("composer.screenshotUnsupported"))
      return
    }
    screenshotStartingRef.current = true
    try {
      const result = await screenshot.start({ conversationId: conversation.id })
      if (result.status === "error") {
        showScreenshotStartError(result.code, t)
      } else {
        dismissScreenshotPermissionToast()
      }
    } catch {
      dismissScreenshotPermissionToast()
      toast.error(t("composer.screenshotStartError"))
    } finally {
      screenshotStartingRef.current = false
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null

    event.target.value = ""

    if (!file) {
      return
    }

    prepareSelectedFile(file)
  }

  function prepareSelectedFile(file: File) {
    const validationError = getFileMessageUploadError(file)
    if (validationError) {
      setSelectedFile(null)
      setFileDialogOpen(false)
      toast.error(validationError)
      return
    }

    setSelectedFile(file)
    setFileDialogOpen(true)
  }

  function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const image = event.target.files?.[0] ?? null

    event.target.value = ""

    if (!image) {
      return
    }

    void prepareSelectedImage(image)
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = getClipboardImageFile(event.clipboardData)

    if (!image) {
      return
    }

    event.preventDefault()
    void prepareSelectedImage(image)
  }

  async function prepareSelectedImage(
    image: File,
    screenshotImport?: Readonly<{
      conversationId: string
      importState: ScreenshotImportState
    }>,
  ) {
    if (sending || (imagePreparing && !screenshotImport)) {
      return
    }

    const preparationId = ++imagePreparationIdRef.current

    setImagePreparing(true)
    setSelectedImage(null)
    setImageCaption("")
    setImageDialogOpen(false)

    try {
      const compressedImage = await compressImageForMessage(image)

      if (preparationId !== imagePreparationIdRef.current) return
      if (
        screenshotImport &&
        !isCurrentScreenshotImport(screenshotImport.importState, screenshotImport.conversationId)
      )
        return

      if (compressedImage.size > imageMessageMaxBytes) {
        toast.error(t("composer.imageTooLarge"))
        return
      }

      setSelectedImage(compressedImage)
      setImageDialogOpen(true)
    } catch (error) {
      if (preparationId !== imagePreparationIdRef.current) return
      if (
        screenshotImport &&
        !isCurrentScreenshotImport(screenshotImport.importState, screenshotImport.conversationId)
      )
        return
      toast.error(error instanceof Error ? error.message : t("composer.readImageError"))
    } finally {
      if (preparationId === imagePreparationIdRef.current) setImagePreparing(false)
    }
  }

  function handleFileDialogOpenChange(open: boolean) {
    if (sending) {
      return
    }

    setFileDialogOpen(open)

    if (!open) {
      setSelectedFile(null)
    }
  }

  async function handleFileSendConfirm() {
    if (!selectedFile || sending) {
      return
    }

    const message = await onSendFile(selectedFile)

    if (message) {
      setFileDialogOpen(false)
      setSelectedFile(null)
    }
  }

  function handleImageDialogOpenChange(open: boolean) {
    if (sending) {
      return
    }

    setImageDialogOpen(open)

    if (!open) {
      setSelectedImage(null)
      setImageCaption("")
    }
  }

  async function handleImageSendConfirm(caption: string) {
    if (!selectedImage || sending) {
      return
    }

    const message = await onSendImage(selectedImage, caption, "text")

    if (message) {
      setImageDialogOpen(false)
      setSelectedImage(null)
      setImageCaption("")
    }
  }

  return (
    <footer
      className="conversation-panel-composer-surface shrink-0 p-4"
      data-testid="conversation-panel-composer"
    >
      <input ref={fileInputRef} className="hidden" onChange={handleFileInputChange} type="file" />
      <input
        ref={imageInputRef}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageInputChange}
        type="file"
      />
      <div className="flex w-full flex-col gap-2" data-testid="conversation-panel-composer-content">
        {replyTarget && (
          <div
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
            data-testid="conversation-reply-preview"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">
                {t("composer.replyTo", { author: replyTarget.author })}
              </div>
              <div className="truncate text-xs text-muted-foreground">{replyTarget.summary}</div>
            </div>
            <Button
              aria-label={t("composer.cancelReply")}
              disabled={sending}
              onClick={onCancelReply}
              size="icon-sm"
              title={t("composer.cancelReply")}
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
        <div className="relative" data-testid="conversation-panel-editor-row">
          <InputGroup className="workspace-composer-editor">
            <InputGroupTextarea
              ref={textareaRef}
              value={draft}
              aria-disabled={sending}
              onBlur={onDraftBlur}
              onChange={handleDraftChange}
              onFocus={onDraftFocus}
              onKeyDown={handleComposerKeyDown}
              onSelect={(event) =>
                updateMentionTrigger(event.currentTarget.value, event.currentTarget.selectionStart)
              }
              onPaste={handleComposerPaste}
              placeholder={
                richTextMode ? t("composer.placeholderMarkdown") : t("composer.placeholder")
              }
              readOnly={sending}
              className="max-h-48 min-h-24"
            />
            <InputGroupAddon
              align="block-end"
              className="justify-between gap-2"
              data-testid="conversation-panel-toolbar-row"
            >
              <div className="flex items-center gap-1">
                <ExpressionPickerPopover
                  align="start"
                  onSelect={handleExpressionSelect}
                  open={expressionPickerOpen}
                  onOpenChange={setExpressionPickerOpen}
                >
                  <InputGroupButton
                    aria-label={t("composer.emoji")}
                    disabled={sending}
                    size="icon-sm"
                    title={t("composer.emoji")}
                  >
                    <Smile className="size-4" />
                  </InputGroupButton>
                </ExpressionPickerPopover>
                <InputGroupButton
                  aria-label={t("composer.upload")}
                  disabled={sending}
                  onClick={handleFileButtonClick}
                  size="icon-sm"
                  title={t("composer.upload")}
                >
                  <Paperclip className="size-4" />
                </InputGroupButton>
                <InputGroupButton
                  aria-label={t("composer.image")}
                  disabled={sending || imagePreparing}
                  onClick={handleImageButtonClick}
                  size="icon-sm"
                  title={t("composer.image")}
                >
                  {imagePreparing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ImageIcon className="size-4" />
                  )}
                </InputGroupButton>
                <InputGroupButton
                  aria-label={t("composer.screenshot")}
                  disabled={sending || imagePreparing}
                  onClick={() => void handleScreenshotButtonClick()}
                  size="icon-sm"
                  title={t("composer.screenshot")}
                >
                  <ScanLine className="size-4" />
                </InputGroupButton>
                <Toggle
                  aria-label={t("composer.markdown")}
                  className="size-8 p-0"
                  disabled={sending}
                  onPressedChange={onRichTextModeChange}
                  pressed={richTextMode}
                  size="sm"
                  title={t("composer.markdown")}
                  type="button"
                >
                  <MarkdownIcon className="size-4" />
                </Toggle>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <InputGroupButton
                  aria-label={t("composer.voice")}
                  disabled={sending}
                  onClick={() => setVoiceDialogOpen(true)}
                  size="icon-sm"
                  title={t("composer.voice")}
                  variant="outline"
                >
                  <Mic className="size-4" />
                </InputGroupButton>
                <InputGroupButton
                  aria-label={t("composer.send")}
                  className="workspace-send-button h-8 px-3"
                  disabled={sending}
                  onClick={handleSendMessage}
                  size="sm"
                  variant="default"
                >
                  {sending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  <span aria-hidden="true">{t("composer.sendLabel")}</span>
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
          {mentionTrigger && filteredMentionCandidates.length > 0 && (
            <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {filteredMentionCandidates.map((candidate, index) => (
                <Button
                  key={`${candidate.targetType}-${candidate.id}`}
                  ref={(element) => {
                    mentionOptionRefs.current[index] = element
                  }}
                  className={cn(
                    "h-auto w-full justify-start gap-2 px-2 py-1.5 text-left",
                    index ===
                      getVisibleMentionIndex(
                        selectedMentionIndex,
                        filteredMentionCandidates.length,
                      ) && "bg-accent",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    insertMentionCandidate(candidate)
                  }}
                  type="button"
                  variant="ghost"
                >
                  <Avatar
                    className={cn(
                      "size-6 rounded-sm after:rounded-sm",
                      candidate.targetType === "all" ? "bg-primary" : "bg-muted",
                    )}
                    data-size="sm"
                  >
                    {candidate.targetType === "all" ? (
                      <AvatarFallback className="rounded-sm bg-transparent text-background">
                        <UsersRound className="size-3.5" />
                      </AvatarFallback>
                    ) : candidate.avatar ? (
                      <AvatarImage
                        alt={candidate.label}
                        className="rounded-sm"
                        src={candidate.avatar}
                      />
                    ) : (
                      <AvatarFallback className="rounded-sm text-xs">
                        {getAvatarInitial(candidate.label)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{candidate.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {candidate.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
      <SendFileMessageDialog
        conversationName={conversation.name}
        file={selectedFile}
        onConfirm={() => void handleFileSendConfirm()}
        onOpenChange={handleFileDialogOpenChange}
        open={fileDialogOpen}
        sending={sending}
      />
      <SendImageMessageDialog
        caption={imageCaption}
        conversationName={conversation.name}
        image={selectedImage}
        mentionCandidates={mentionCandidates}
        onCaptionChange={setImageCaption}
        onConfirm={(caption) => void handleImageSendConfirm(caption)}
        onOpenChange={handleImageDialogOpenChange}
        open={imageDialogOpen}
        sending={sending}
      />
      <VoiceInputDialog
        conversationName={conversation.name}
        onOpenChange={setVoiceDialogOpen}
        onSendText={onSendMessage}
        onSendVoice={onSendVoice}
        open={voiceDialogOpen}
        sending={sending}
      />
    </footer>
  )
})
