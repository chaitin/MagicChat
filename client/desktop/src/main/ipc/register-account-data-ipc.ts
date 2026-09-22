import type { BrowserWindow } from "electron"
import {
  ACCOUNT_DATA_CHANNELS,
  type AvatarRequest,
  type CreateGroupConversationInput,
  type LocalSearchInput,
  type MessageReactionUsersInput,
  type RetryMessageInput,
  type SendFileMessageInput,
  type SendImageMessageInput,
  type SendTextMessageInput,
  type SendVideoMessageInput,
  type SetMessageReactionInput,
  type SubmitChoiceResponseInput,
} from "../../shared/account-data"
import { AuthFailure } from "../../shared/auth"
import type { AuthController } from "../auth-controller"
import type { SelectedMessageFileStore } from "../message-files/selected-message-file-store"

export type IpcRegistrar = <T>(channel: string, operation: (input: unknown) => Promise<T>) => void

export function registerAccountDataIpc({
  handle,
  auth,
  selectedMessageFiles,
  getMainWindow,
}: {
  handle: IpcRegistrar
  auth: AuthController
  selectedMessageFiles: SelectedMessageFileStore
  getMainWindow: () => BrowserWindow | null
}) {
  handle(ACCOUNT_DATA_CHANNELS.initialize, (input) => auth.initializeAccountData(input as string))
  handle(ACCOUNT_DATA_CHANNELS.refreshAll, (input) => auth.refreshAll(input as string))
  handle(ACCOUNT_DATA_CHANNELS.searchLocal, (input) => auth.searchLocal(input as LocalSearchInput))
  handle(ACCOUNT_DATA_CHANNELS.listConversations, (input) =>
    auth.listConversations(input as string),
  )
  handle(ACCOUNT_DATA_CHANNELS.createGroupConversation, (input) =>
    auth.createGroupConversation(input as CreateGroupConversationInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.listMessages, (input) => {
    const value = input as { targetId?: string; conversationId?: string } | undefined
    return auth.listMessages(value?.targetId ?? "", value?.conversationId ?? "")
  })
  handle(ACCOUNT_DATA_CHANNELS.selectMessageFile, async (input) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new AuthFailure("window_unavailable", "主窗口不可用")
    return selectedMessageFiles.selectFile(typeof input === "string" ? input : "", mainWindow)
  })
  handle(ACCOUNT_DATA_CHANNELS.importMessageFile, async (input) => {
    const value = input as { targetId?: string } | undefined
    await auth.getContacts(value?.targetId ?? "")
    return selectedMessageFiles.importFile(input)
  })
  handle(ACCOUNT_DATA_CHANNELS.releaseMessageFile, async (input) => {
    const value = input as { targetId?: string; token?: string } | undefined
    await auth.getContacts(value?.targetId ?? "")
    await selectedMessageFiles.release(value?.token ?? "", value?.targetId ?? "")
    return null
  })
  handle(ACCOUNT_DATA_CHANNELS.selectMessageMedia, async (input) => {
    const mainWindow = getMainWindow()
    if (!mainWindow) throw new AuthFailure("window_unavailable", "主窗口不可用")
    return selectedMessageFiles.selectMedia(
      input as { targetId?: string; category?: "image" | "video" } | undefined,
      mainWindow,
    )
  })
  handle(ACCOUNT_DATA_CHANNELS.sendFileMessage, async (input) => {
    const value = input as SendFileMessageInput | undefined
    if (!value) throw new AuthFailure("invalid_file_selection", "所选文件已失效，请重新选择")
    const selected = selectedMessageFiles.getFile(value.selectionToken, value.targetId)
    await selectedMessageFiles.assertUnchanged(
      selected,
      "file_changed",
      "所选文件已发生变化，请重新选择",
    )
    const messages = await auth.sendFileMessage(value, {
      ...selected,
      temporary: selected.staged === true,
    })
    selectedMessageFiles.consume(value.selectionToken, value.targetId)
    return messages
  })
  handle(ACCOUNT_DATA_CHANNELS.sendImageMessage, async (input) => {
    const value = input as SendImageMessageInput | undefined
    if (!value) throw new AuthFailure("invalid_image_selection", "所选图片已失效，请重新选择")
    selectedMessageFiles.getMedia(
      value.selectionToken,
      value.targetId,
      "image",
      "invalid_image_selection",
    )
    const staged = await selectedMessageFiles.stageImage(value)
    try {
      const messages = await auth.sendImageMessage(value, staged)
      await selectedMessageFiles.release(value.selectionToken, value.targetId)
      return messages
    } catch (error) {
      await staged.remove()
      throw error
    }
  })
  handle(ACCOUNT_DATA_CHANNELS.sendVideoMessage, async (input) => {
    const value = input as SendVideoMessageInput | undefined
    if (!value) throw new AuthFailure("invalid_video_selection", "所选视频已失效，请重新选择")
    const selected = selectedMessageFiles.getMedia(
      value.selectionToken,
      value.targetId,
      "video",
      "invalid_video_selection",
    )
    if (selected.contentType !== "video/mp4" && selected.contentType !== "video/webm") {
      throw new AuthFailure("invalid_video_selection", "所选视频已失效，请重新选择")
    }
    await selectedMessageFiles.assertUnchanged(
      selected,
      "video_changed",
      "所选视频已发生变化，请重新选择",
    )
    const messages = await auth.sendVideoMessage(value, {
      path: selected.path,
      name: selected.name,
      sizeBytes: selected.sizeBytes,
      contentType: selected.contentType,
      temporary: selected.staged === true,
    })
    selectedMessageFiles.consume(value.selectionToken, value.targetId)
    return messages
  })
  handle(ACCOUNT_DATA_CHANNELS.sendTextMessage, (input) =>
    auth.sendTextMessage(input as SendTextMessageInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.retryMessage, (input) =>
    auth.retryMessage(input as RetryMessageInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.setMessageReaction, (input) =>
    auth.setMessageReaction(input as SetMessageReactionInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.submitChoiceResponse, (input) =>
    auth.submitChoiceResponse(input as SubmitChoiceResponseInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.listMessageReactionUsers, (input) =>
    auth.listMessageReactionUsers(input as MessageReactionUsersInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.loadBeforeMessages, (input) => {
    const value = input as
      | { targetId?: string; conversationId?: string; beforeSeq?: number }
      | undefined
    return auth.loadBeforeMessages(
      value?.targetId ?? "",
      value?.conversationId ?? "",
      value?.beforeSeq ?? 0,
    )
  })
  handle(ACCOUNT_DATA_CHANNELS.getContacts, (input) => auth.getContacts(input as string))
  handle(ACCOUNT_DATA_CHANNELS.getAvatar, (input) => auth.getAvatar(input as AvatarRequest))
  handle(ACCOUNT_DATA_CHANNELS.invalidateAvatar, (input) =>
    auth.invalidateAvatar(input as Omit<AvatarRequest, "theme">),
  )
}
