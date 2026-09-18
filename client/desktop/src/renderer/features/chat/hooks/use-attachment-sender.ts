import { useCallback, useEffect, useState } from "react"
import type {
  DesktopConversation,
  DesktopMessage,
  SelectedMessageFile,
  SelectedMessageMedia,
} from "../../../../shared/account-data"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { prepareImageMessage, type PreparedImageMessage } from "../image-message"

export function useAttachmentSender({
  targetId,
  selected,
  focusComposer,
  onMessages,
}: {
  targetId: string
  selected: DesktopConversation | null
  focusComposer: () => void
  onMessages: (conversationId: string, messages: DesktopMessage[]) => void
}) {
  const { showToast } = useAnimatedToast()
  const [selectingFile, setSelectingFile] = useState(false)
  const [sendingFile, setSendingFile] = useState(false)
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<{
    file: SelectedMessageFile
    conversationId: string
    conversationName: string
  } | null>(null)
  const [selectingMedia, setSelectingMedia] = useState<"image" | "video" | null>(null)
  const [sendingMedia, setSendingMedia] = useState<"image" | "video" | null>(null)
  const [mediaCaption, setMediaCaption] = useState("")
  const [pendingImage, setPendingImage] = useState<{
    selected: SelectedMessageMedia
    prepared: PreparedImageMessage
    conversationId: string
    conversationName: string
  } | null>(null)
  const [pendingVideo, setPendingVideo] = useState<{
    selected: SelectedMessageMedia
    conversationId: string
    conversationName: string
  } | null>(null)

  const clearPendingImage = useCallback(() => {
    setPendingImage(null)
    setMediaCaption("")
  }, [])

  const selectFile = useCallback(async () => {
    if (!window.desktop || !selected || selectingFile || sendingFile) return
    setSelectingFile(true)
    try {
      const result = await window.desktop.accountData.selectMessageFile(targetId)
      if (!result.ok) {
        showToast({
          status: "error",
          title: "选择文件失败",
          description: result.error.message,
        })
        return
      }
      if (!result.data) return
      setPendingFile({
        file: result.data,
        conversationId: selected.id,
        conversationName: selected.name,
      })
      setFileDialogOpen(true)
    } catch {
      showToast({ status: "error", title: "选择文件失败" })
    } finally {
      setSelectingFile(false)
    }
  }, [selected, selectingFile, sendingFile, showToast, targetId])

  const sendPendingFile = useCallback(async () => {
    if (!window.desktop || !pendingFile || sendingFile) return
    setSendingFile(true)
    try {
      const result = await window.desktop.accountData.sendFileMessage({
        targetId,
        conversationId: pendingFile.conversationId,
        selectionToken: pendingFile.file.token,
      })
      if (!result.ok) {
        showToast({
          status: "error",
          title: "发送文件失败",
          description: result.error.message,
        })
        return
      }
      onMessages(pendingFile.conversationId, result.data)
      setFileDialogOpen(false)
      setPendingFile(null)
      focusComposer()
    } catch {
      showToast({ status: "error", title: "发送文件失败" })
    } finally {
      setSendingFile(false)
    }
  }, [focusComposer, onMessages, pendingFile, sendingFile, showToast, targetId])

  const selectMedia = useCallback(
    async (category: "image" | "video") => {
      if (!window.desktop || !selected || selectingMedia || sendingMedia) return
      setSelectingMedia(category)
      try {
        const result = await window.desktop.accountData.selectMessageMedia({ targetId, category })
        if (!result.ok) {
          showToast({
            status: "error",
            title: `选择${category === "image" ? "图片" : "视频"}失败`,
            description: result.error.message,
          })
          return
        }
        if (!result.data) return
        setMediaCaption("")
        if (category === "image") {
          const prepared = await prepareImageMessage(result.data)
          clearPendingImage()
          setPendingImage({
            selected: result.data,
            prepared,
            conversationId: selected.id,
            conversationName: selected.name,
          })
        } else {
          setPendingVideo({
            selected: result.data,
            conversationId: selected.id,
            conversationName: selected.name,
          })
        }
      } catch (error) {
        showToast({
          status: "error",
          title: `${category === "image" ? "读取图片" : "选择视频"}失败`,
          description: error instanceof Error ? error.message : undefined,
        })
      } finally {
        setSelectingMedia(null)
      }
    },
    [clearPendingImage, selected, selectingMedia, sendingMedia, showToast, targetId],
  )

  const sendPendingImage = useCallback(async () => {
    if (!window.desktop || !pendingImage || sendingMedia) return
    setSendingMedia("image")
    try {
      const contentType = pendingImage.prepared.blob.type
      if (contentType !== "image/webp" && contentType !== "image/png") {
        throw new Error("图片内容格式不正确")
      }
      const result = await window.desktop.accountData.sendImageMessage({
        targetId,
        conversationId: pendingImage.conversationId,
        selectionToken: pendingImage.selected.token,
        bytes: await pendingImage.prepared.blob.arrayBuffer(),
        name: pendingImage.prepared.name,
        contentType,
        width: pendingImage.prepared.width,
        height: pendingImage.prepared.height,
        caption: mediaCaption,
      })
      if (!result.ok) {
        showToast({
          status: "error",
          title: "发送图片失败",
          description: result.error.message,
        })
        return
      }
      onMessages(pendingImage.conversationId, result.data)
      clearPendingImage()
      focusComposer()
    } catch (error) {
      showToast({
        status: "error",
        title: "发送图片失败",
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSendingMedia(null)
    }
  }, [
    clearPendingImage,
    focusComposer,
    mediaCaption,
    onMessages,
    pendingImage,
    sendingMedia,
    showToast,
    targetId,
  ])

  const sendPendingVideo = useCallback(async () => {
    if (!window.desktop || !pendingVideo || sendingMedia) return
    setSendingMedia("video")
    try {
      const result = await window.desktop.accountData.sendVideoMessage({
        targetId,
        conversationId: pendingVideo.conversationId,
        selectionToken: pendingVideo.selected.token,
        caption: mediaCaption,
      })
      if (!result.ok) {
        showToast({
          status: "error",
          title: "发送视频失败",
          description: result.error.message,
        })
        return
      }
      onMessages(pendingVideo.conversationId, result.data)
      setPendingVideo(null)
      setMediaCaption("")
      focusComposer()
    } catch {
      showToast({ status: "error", title: "发送视频失败" })
    } finally {
      setSendingMedia(null)
    }
  }, [focusComposer, mediaCaption, onMessages, pendingVideo, sendingMedia, showToast, targetId])

  useEffect(() => {
    const resourceUrl = pendingImage?.prepared.resourceUrl
    return () => {
      if (resourceUrl) URL.revokeObjectURL(resourceUrl)
    }
  }, [pendingImage?.prepared.resourceUrl])

  function closeFileDialog() {
    if (sendingFile) return
    setFileDialogOpen(false)
    setPendingFile(null)
    focusComposer()
  }

  function closeImageDialog() {
    if (sendingMedia) return
    clearPendingImage()
    focusComposer()
  }

  function closeVideoDialog() {
    if (sendingMedia) return
    setPendingVideo(null)
    setMediaCaption("")
    focusComposer()
  }

  return {
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
  }
}
