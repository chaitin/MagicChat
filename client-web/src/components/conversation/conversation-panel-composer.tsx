import * as React from "react"
import {
  Film,
  ImageIcon,
  LoaderCircle,
  Mic,
  Paperclip,
  Smile,
  X,
} from "lucide-react"
import { toast } from "sonner"
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
import { getFileMessageUploadError } from "@/lib/file-message"
import type { ConversationDraftMention } from "@/lib/conversation-drafts"
import type { VoiceMessageRecording } from "@/lib/voice-message"
import { getVideoMessageUploadError } from "@/lib/video-message"
import {
  createDraftMentionTemplate,
  createMentionCandidates,
  filterMentionCandidates,
  getClipboardImageFile,
  getMentionTrigger,
  getVisibleMentionIndex,
  insertDraftMention,
  insertTextareaText,
  isImeCompositionKeyEvent,
  syncDraftMentions,
  type MentionCandidate,
  type MentionTrigger,
} from "@/lib/conversation-composer"
import { type ExpressionItem } from "@/components/expression-picker"
import { ExpressionPickerPopover } from "@/components/expression-picker-popover"
import { VoiceInputDialog } from "@/components/conversation/voice-input-dialog"
import { MentionCandidateMenu } from "@/components/conversation/mention-candidate-menu"
import { MarkdownIcon } from "@/components/icons/markdown-icon"
import { Button } from "@/components/ui/button"
import { SendFileMessageDialog } from "@/components/send-file-message-dialog"
import { SendImageMessageDialog } from "@/components/send-image-message-dialog"
import { SendVideoMessageDialog } from "@/components/send-video-message-dialog"
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

const draftSyncDelayMs = 400

function areDraftMentionsEqual(
  left: ConversationDraftMention[],
  right: ConversationDraftMention[]
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

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
    onDraftPresenceChange?: (draft: string) => void
    onDraftChange: (draft: string, mentions: ConversationDraftMention[]) => void
    onSendFile: (file: File) => Promise<ClientMessage | null>
    onSendImage: (
      image: File,
      caption: string,
      captionType: ImageCaptionType
    ) => Promise<ClientMessage | null>
    onSendVideo?: (
      video: File,
      caption: string,
      captionType: ImageCaptionType
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
    onDraftPresenceChange,
    onDraftChange,
    onSendFile,
    onSendImage,
    onSendVideo,
    onSendVoice,
    onRichTextModeChange,
    onSendMessage,
    richTextMode,
    sending,
  },
  ref
) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const imageInputRef = React.useRef<HTMLInputElement | null>(null)
  const videoInputRef = React.useRef<HTMLInputElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const previousSendingRef = React.useRef(sending)
  const shouldFocusAfterSendingRef = React.useRef(false)
  const [localDraft, setLocalDraft] = React.useState(draft)
  const [localDraftMentions, setLocalDraftMentions] =
    React.useState(draftMentions)
  const localDraftRef = React.useRef({ mentions: draftMentions, text: draft })
  const draftSyncTimerRef = React.useRef<number | null>(null)
  const onDraftChangeRef = React.useRef(onDraftChange)
  const lastEmittedDraftRef = React.useRef<{
    mentions: ConversationDraftMention[]
    text: string
  } | null>(null)
  const externalDraftRef = React.useRef({
    mentions: draftMentions,
    text: draft,
  })
  const previousConversationIdRef = React.useRef(conversation.id)
  const sendInFlightRef = React.useRef(false)
  const videoSendInFlightRef = React.useRef(false)
  onDraftChangeRef.current = onDraftChange
  const [expressionPickerOpen, setExpressionPickerOpen] = React.useState(false)
  const [fileDialogOpen, setFileDialogOpen] = React.useState(false)
  const [imageDialogOpen, setImageDialogOpen] = React.useState(false)
  const [videoDialogOpen, setVideoDialogOpen] = React.useState(false)
  const [videoSending, setVideoSending] = React.useState(false)
  const [imagePreparing, setImagePreparing] = React.useState(false)
  const [voiceInputDialogOpen, setVoiceInputDialogOpen] = React.useState(false)
  const [mentionTrigger, setMentionTrigger] =
    React.useState<MentionTrigger | null>(null)
  const [selectedMentionIndex, setSelectedMentionIndex] = React.useState(0)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const [selectedImage, setSelectedImage] = React.useState<File | null>(null)
  const [imageCaption, setImageCaption] = React.useState("")
  const [selectedVideo, setSelectedVideo] = React.useState<File | null>(null)
  const [videoCaption, setVideoCaption] = React.useState("")
  const mentionCandidates = React.useMemo(
    () =>
      conversation.type === "group" ||
      conversation.topic?.parentConversationType === "group"
        ? createMentionCandidates(conversation.members ?? [])
        : [],
    [
      conversation.members,
      conversation.topic?.parentConversationType,
      conversation.type,
    ]
  )
  const filteredMentionCandidates = React.useMemo(
    () =>
      filterMentionCandidates(mentionCandidates, mentionTrigger?.query ?? ""),
    [mentionCandidates, mentionTrigger?.query]
  )

  React.useImperativeHandle(ref, () => ({
    focus() {
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    focusAtEnd() {
      window.requestAnimationFrame(() => {
        const textarea = textareaRef.current
        if (!textarea) {
          return
        }

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

  const cancelScheduledDraftSync = React.useCallback(() => {
    if (draftSyncTimerRef.current !== null) {
      window.clearTimeout(draftSyncTimerRef.current)
      draftSyncTimerRef.current = null
    }
  }, [])

  const flushLocalDraft = React.useCallback(() => {
    cancelScheduledDraftSync()
    const current = localDraftRef.current
    lastEmittedDraftRef.current = current
    onDraftChangeRef.current(current.text, current.mentions)
  }, [cancelScheduledDraftSync])

  const setLocalDraftContent = React.useCallback(
    (text: string, mentions: ConversationDraftMention[]) => {
      localDraftRef.current = { mentions, text }
      setLocalDraft(text)
      setLocalDraftMentions(mentions)
      onDraftPresenceChange?.(text)
      cancelScheduledDraftSync()
      draftSyncTimerRef.current = window.setTimeout(
        flushLocalDraft,
        draftSyncDelayMs
      )
    },
    [cancelScheduledDraftSync, flushLocalDraft, onDraftPresenceChange]
  )

  React.useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  React.useEffect(() => {
    // Flush the old conversation before adopting the next conversation's draft.
    return flushLocalDraft
  }, [conversation.id, flushLocalDraft])

  React.useEffect(() => {
    if (previousConversationIdRef.current === conversation.id) return
    previousConversationIdRef.current = conversation.id
    cancelScheduledDraftSync()
    const incoming = { mentions: draftMentions, text: draft }
    externalDraftRef.current = incoming
    lastEmittedDraftRef.current = null
    localDraftRef.current = incoming
    setLocalDraft(draft)
    setLocalDraftMentions(draftMentions)
  }, [cancelScheduledDraftSync, conversation.id, draft, draftMentions])

  React.useEffect(() => {
    const previous = externalDraftRef.current
    const externallyChanged =
      previous.text !== draft ||
      !areDraftMentionsEqual(previous.mentions, draftMentions)
    if (!externallyChanged) return

    const incoming = { mentions: draftMentions, text: draft }
    externalDraftRef.current = incoming
    const emitted = lastEmittedDraftRef.current
    if (
      emitted &&
      emitted.text === draft &&
      areDraftMentionsEqual(emitted.mentions, draftMentions)
    ) {
      return
    }
    cancelScheduledDraftSync()
    localDraftRef.current = incoming
    setLocalDraft(draft)
    setLocalDraftMentions(draftMentions)
  }, [cancelScheduledDraftSync, draft, draftMentions])

  React.useEffect(() => {
    function handlePageHide() {
      flushLocalDraft()
      onDraftBlur?.()
    }
    window.addEventListener("pagehide", handlePageHide)
    return () => window.removeEventListener("pagehide", handlePageHide)
  }, [flushLocalDraft, onDraftBlur])

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
    const nextMentions = syncDraftMentions(
      localDraftMentions,
      localDraft,
      nextDraft
    )

    setLocalDraftContent(nextDraft, nextMentions)
    updateMentionTrigger(nextDraft, cursor)
  }

  function updateMentionTrigger(value: string, cursor: number) {
    if (
      (conversation.type !== "group" &&
        conversation.topic?.parentConversationType !== "group") ||
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
    if (!localDraft.trim() || sendInFlightRef.current) return

    const submitted = localDraftRef.current
    const empty = { mentions: [] as ConversationDraftMention[], text: "" }
    sendInFlightRef.current = true
    shouldFocusAfterSendingRef.current = true
    flushLocalDraft()
    localDraftRef.current = empty
    lastEmittedDraftRef.current = empty
    setLocalDraft("")
    setLocalDraftMentions([])
    onDraftChangeRef.current("", [])
    setMentionTrigger(null)
    setSelectedMentionIndex(0)
    try {
      let accepted = false
      try {
        accepted = await onSendMessage(
          createDraftMentionTemplate(submitted.text, submitted.mentions)
        )
      } catch {
        // The page owns error presentation.
      }
      if (accepted) {
        if (localDraftRef.current !== empty) flushLocalDraft()
        return
      }
      if (localDraftRef.current !== empty) {
        flushLocalDraft()
        return
      }
      localDraftRef.current = submitted
      lastEmittedDraftRef.current = submitted
      setLocalDraft(submitted.text)
      setLocalDraftMentions(submitted.mentions)
      onDraftChangeRef.current(submitted.text, submitted.mentions)
    } finally {
      sendInFlightRef.current = false
    }
  }

  function handleComposerKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (isImeCompositionKeyEvent(event)) {
      return
    }

    if (mentionTrigger && filteredMentionCandidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedMentionIndex(
          (currentIndex) =>
            (currentIndex + 1) % filteredMentionCandidates.length
        )
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedMentionIndex(
          (currentIndex) =>
            (currentIndex - 1 + filteredMentionCandidates.length) %
            filteredMentionCandidates.length
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
            getVisibleMentionIndex(
              selectedMentionIndex,
              filteredMentionCandidates.length
            )
          ] ?? filteredMentionCandidates[0]
        )
        return
      }
    }

    if (event.key !== "Enter") {
      return
    }

    if (event.shiftKey || event.ctrlKey) {
      event.preventDefault()
      insertTextareaText(event.currentTarget, "\n", handleTextareaValueChange)
      return
    }

    event.preventDefault()
    handleSendMessage()
  }

  function handleTextareaValueChange(value: string, cursor?: number) {
    setLocalDraftContent(
      value,
      syncDraftMentions(localDraftMentions, localDraft, value)
    )
    updateMentionTrigger(value, cursor ?? value.length)
  }

  function insertMentionCandidate(candidate: MentionCandidate | undefined) {
    if (!candidate) {
      return
    }

    const textarea = textareaRef.current
    const cursor = textarea?.selectionStart ?? localDraft.length
    const trigger = getMentionTrigger(localDraft, cursor)

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
    }
  ) {
    const textarea = textareaRef.current
    const selectionStart =
      range?.start ?? textarea?.selectionStart ?? localDraft.length
    const selectionEnd = range?.end ?? textarea?.selectionEnd ?? selectionStart

    const inserted = insertDraftMention(
      localDraft,
      localDraftMentions,
      target,
      selectionStart,
      selectionEnd
    )

    setLocalDraftContent(inserted.value, inserted.mentions)
    setMentionTrigger(null)
    setSelectedMentionIndex(0)

    window.requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return
      }

      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(inserted.cursor, inserted.cursor)
    })
  }

  function handleExpressionSelect(item: ExpressionItem) {
    if (sending) {
      return
    }

    const textarea = textareaRef.current

    if (!textarea) {
      handleTextareaValueChange(localDraft + item.value)
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

  function handleVideoButtonClick() {
    videoInputRef.current?.click()
  }

  function handleVideoInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const video = event.target.files?.[0] ?? null
    event.target.value = ""
    if (!video) return
    const validationError = getVideoMessageUploadError(video)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setSelectedVideo(video)
    setVideoCaption("")
    setVideoDialogOpen(true)
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

  function handleComposerPaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>
  ) {
    const image = getClipboardImageFile(event.clipboardData)

    if (!image) {
      return
    }

    event.preventDefault()
    void prepareSelectedImage(image)
  }

  async function prepareSelectedImage(image: File) {
    if (sending || imagePreparing) {
      return
    }

    setImagePreparing(true)
    setSelectedImage(null)
    setImageCaption("")
    setImageDialogOpen(false)

    try {
      const compressedImage = await compressImageForMessage(image)

      if (compressedImage.size > imageMessageMaxBytes) {
        toast.error("图片大于 2MB，无法上传")
        return
      }

      setSelectedImage(compressedImage)
      setImageDialogOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "读取图片失败")
    } finally {
      setImagePreparing(false)
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

  function handleVideoDialogOpenChange(open: boolean) {
    if (videoSending) return
    setVideoDialogOpen(open)
    if (!open) {
      setSelectedVideo(null)
      setVideoCaption("")
    }
  }

  async function handleVideoSendConfirm(caption: string) {
    if (!onSendVideo || !selectedVideo || videoSendInFlightRef.current) return
    videoSendInFlightRef.current = true
    setVideoSending(true)
    try {
      const message = await onSendVideo(selectedVideo, caption, "text")
      if (message) {
        setVideoDialogOpen(false)
        setSelectedVideo(null)
        setVideoCaption("")
      }
    } finally {
      videoSendInFlightRef.current = false
      setVideoSending(false)
    }
  }

  return (
    <footer
      className="shrink-0 border-t p-4"
      data-testid="conversation-panel-composer"
    >
      <input
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileInputChange}
        type="file"
      />
      <input
        ref={imageInputRef}
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleImageInputChange}
        type="file"
      />
      {onSendVideo && (
        <input
          ref={videoInputRef}
          accept="video/mp4,video/webm"
          className="hidden"
          onChange={handleVideoInputChange}
          type="file"
        />
      )}
      <div
        className="flex w-full flex-col gap-2"
        data-testid="conversation-panel-composer-content"
      >
        {replyTarget && (
          <div
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
            data-testid="conversation-reply-preview"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">
                回复 {replyTarget.author}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {replyTarget.summary}
              </div>
            </div>
            <Button
              aria-label="取消回复"
              disabled={sending}
              onClick={onCancelReply}
              size="icon-sm"
              title="取消回复"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
        <div className="relative" data-testid="conversation-panel-editor-row">
          <InputGroup>
            <InputGroupTextarea
              ref={textareaRef}
              value={localDraft}
              onBlur={() => {
                flushLocalDraft()
                onDraftBlur?.()
              }}
              onFocus={() => {
                onDraftPresenceChange?.(localDraftRef.current.text)
                onDraftFocus?.()
              }}
              onChange={handleDraftChange}
              onKeyDown={handleComposerKeyDown}
              onSelect={(event) =>
                updateMentionTrigger(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart
                )
              }
              onPaste={handleComposerPaste}
              placeholder={richTextMode ? "输入 Markdown 消息" : "输入消息"}
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
                    aria-label="选择表情"
                    disabled={sending}
                    size="icon-sm"
                    title="选择表情"
                  >
                    <Smile className="size-4" />
                  </InputGroupButton>
                </ExpressionPickerPopover>
                <InputGroupButton
                  aria-label="上传文件"
                  disabled={sending}
                  onClick={handleFileButtonClick}
                  size="icon-sm"
                  title="上传文件"
                >
                  <Paperclip className="size-4" />
                </InputGroupButton>
                <InputGroupButton
                  aria-label="插入图片"
                  disabled={sending || imagePreparing}
                  onClick={handleImageButtonClick}
                  size="icon-sm"
                  title="插入图片"
                >
                  {imagePreparing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <ImageIcon className="size-4" />
                  )}
                </InputGroupButton>
                {onSendVideo && (
                  <InputGroupButton
                    aria-label="插入视频"
                    disabled={sending}
                    onClick={handleVideoButtonClick}
                    size="icon-sm"
                    title="插入视频"
                  >
                    <Film className="size-4" />
                  </InputGroupButton>
                )}
                <Toggle
                  aria-label="支持 markdown"
                  className="size-8 p-0"
                  disabled={sending}
                  onPressedChange={onRichTextModeChange}
                  pressed={richTextMode}
                  size="sm"
                  title="支持 markdown"
                  type="button"
                >
                  <MarkdownIcon className="size-4" />
                </Toggle>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <InputGroupButton
                  aria-label="语音输入"
                  disabled={sending}
                  onClick={() => setVoiceInputDialogOpen(true)}
                  size="icon-sm"
                  title="语音输入"
                  variant="ghost"
                >
                  <Mic className="size-4" />
                </InputGroupButton>
                <InputGroupButton
                  aria-label="发送消息"
                  className="bg-(--weui-brand-3) text-white hover:bg-(--weui-brand-4) dark:text-white"
                  onClick={handleSendMessage}
                  size="sm"
                  variant="default"
                >
                  <span aria-hidden="true">发送</span>
                </InputGroupButton>
              </div>
            </InputGroupAddon>
          </InputGroup>
          {mentionTrigger && filteredMentionCandidates.length > 0 && (
            <MentionCandidateMenu
              candidates={filteredMentionCandidates}
              onSelect={insertMentionCandidate}
              selectedIndex={selectedMentionIndex}
            />
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
      {onSendVideo && (
        <SendVideoMessageDialog
          caption={videoCaption}
          conversationName={conversation.name}
          mentionCandidates={mentionCandidates}
          onCaptionChange={setVideoCaption}
          onConfirm={(caption) => void handleVideoSendConfirm(caption)}
          onOpenChange={handleVideoDialogOpenChange}
          open={videoDialogOpen}
          sending={videoSending}
          video={selectedVideo}
        />
      )}
      <VoiceInputDialog
        onSendText={onSendMessage}
        onSendVoice={onSendVoice}
        onOpenChange={setVoiceInputDialogOpen}
        open={voiceInputDialogOpen}
        sending={sending}
      />
    </footer>
  )
})
