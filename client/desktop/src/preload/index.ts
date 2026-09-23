import { contextBridge, ipcRenderer, webUtils } from "electron"
import { ACCOUNT_DATA_CHANNELS } from "../shared/account-data"
import { DESKTOP_CHANNELS, type DesktopBridge } from "../shared/desktop"
import { AUTH_CHANNELS } from "../shared/auth"
import { MEDIA_CHANNELS, type MediaDownloadProgress } from "../shared/media"

const platform =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

const bridge: DesktopBridge = {
  openHomepage: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openHomepage),
  openExternalLink: (url) => ipcRenderer.invoke(DESKTOP_CHANNELS.openExternalLink, url),
  openWebLink: (url) => ipcRenderer.invoke(DESKTOP_CHANNELS.openWebLink, url),
  copyText: (text) => ipcRenderer.invoke(DESKTOP_CHANNELS.copyText, text),
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_CHANNELS.checkForUpdates),
  getSystemInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getSystemInfo),
  getStorageInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getStorageInfo),
  openStorageDirectory: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openStorageDirectory),
  calculateStorageUsage: () => ipcRenderer.invoke(DESKTOP_CHANNELS.calculateStorageUsage),
  getAppSettings: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getAppSettings),
  setTheme: (theme) => ipcRenderer.invoke(DESKTOP_CHANNELS.setTheme, theme),
  setNotificationSettings: (settings) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setNotificationSettings, settings),
  setShortcutSettings: (settings) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setShortcutSettings, settings),
  setShortcutRecording: (recording) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.setShortcutRecording, recording),
  onOpenSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(DESKTOP_CHANNELS.openSettings, listener)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.openSettings, listener)
  },
  onRequestSignOut: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(DESKTOP_CHANNELS.requestSignOut, listener)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.requestSignOut, listener)
  },
  onRequestQuit: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(DESKTOP_CHANNELS.requestQuit, listener)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.requestQuit, listener)
  },
  windowControls: {
    platform,
    getMaximized: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowGetState),
    minimize: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowToggleMaximize),
    close: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowClose),
    quit: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowQuit),
    onMaximizedChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        callback(maximized)
      ipcRenderer.on(DESKTOP_CHANNELS.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.windowMaximizedChanged, listener)
    },
  },
  media: {
    ensureCached: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.ensureCached, input),
    checkCached: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.checkCached, input),
    revealCached: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.revealCached, input),
    copyImage: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.copyImage, input),
    openPreview: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.openPreview, input),
    onDownloadProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: MediaDownloadProgress) =>
        callback(value)
      ipcRenderer.on(MEDIA_CHANNELS.downloadProgress, listener)
      return () => ipcRenderer.removeListener(MEDIA_CHANNELS.downloadProgress, listener)
    },
  },
  accountData: {
    initialize: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.initialize, targetId),
    refreshAll: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.refreshAll, targetId),
    searchLocal: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.searchLocal, input),
    listConversations: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listConversations, targetId),
    createGroupConversation: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.createGroupConversation, input),
    setConversationPinned: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.setConversationPinned, input),
    setConversationMuted: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.setConversationMuted, input),
    dismissConversation: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.dismissConversation, input),
    listMessages: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listMessages, input),
    loadBeforeMessages: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.loadBeforeMessages, input),
    sendTextMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendTextMessage, input),
    sendRichMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendRichMessage, input),
    selectMessageFile: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.selectMessageFile, targetId),
    importMessageFile: async ({ targetId, file }) => {
      let filePath = ""
      try {
        filePath = webUtils.getPathForFile(file)
      } catch {
        // Clipboard images can be generated in memory without a backing file.
      }
      return ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.importMessageFile, {
        targetId,
        path: filePath,
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        bytes: !filePath && file.size <= 20 * 1024 * 1024 ? await file.arrayBuffer() : undefined,
      })
    },
    releaseMessageFile: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.releaseMessageFile, input),
    selectMessageMedia: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.selectMessageMedia, input),
    sendFileMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendFileMessage, input),
    sendImageMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendImageMessage, input),
    sendVideoMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendVideoMessage, input),
    retryMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.retryMessage, input),
    createMessageTopic: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.createMessageTopic, input),
    revokeMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.revokeMessage, input),
    sendConversationStatus: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendConversationStatus, input),
    setMessageReaction: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.setMessageReaction, input),
    submitChoiceResponse: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.submitChoiceResponse, input),
    listMessageReactionUsers: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listMessageReactionUsers, input),
    getContacts: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.getContacts, targetId),
    refreshContacts: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.refreshContacts, targetId),
    searchContactUsers: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.searchContactUsers, input),
    listFriendRequests: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listFriendRequests, input),
    createFriendRequest: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.createFriendRequest, input),
    acceptFriendRequest: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.acceptFriendRequest, input),
    rejectFriendRequest: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.rejectFriendRequest, input),
    cancelFriendRequest: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.cancelFriendRequest, input),
    deleteFriend: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.deleteFriend, input),
    openContactConversation: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.openContactConversation, input),
    createClientApp: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.createClientApp, input),
    getClientApp: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.getClientApp, input),
    updateClientApp: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.updateClientApp, input),
    deleteClientApp: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.deleteClientApp, input),
    regenerateClientAppSecret: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.regenerateClientAppSecret, input),
    selectClientAppAvatar: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.selectClientAppAvatar, targetId),
    uploadClientAppAvatar: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.uploadClientAppAvatar, input),
    getAvatar: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.getAvatar, input),
    invalidateAvatar: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.invalidateAvatar, input),
    onSyncStateChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value)
      ipcRenderer.on(ACCOUNT_DATA_CHANNELS.syncStateChanged, listener)
      return () => ipcRenderer.removeListener(ACCOUNT_DATA_CHANNELS.syncStateChanged, listener)
    },
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value)
      ipcRenderer.on(ACCOUNT_DATA_CHANNELS.changed, listener)
      return () => ipcRenderer.removeListener(ACCOUNT_DATA_CHANNELS.changed, listener)
    },
    onConversationPresenceChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) =>
        callback(value)
      ipcRenderer.on(ACCOUNT_DATA_CHANNELS.conversationPresenceChanged, listener)
      return () =>
        ipcRenderer.removeListener(ACCOUNT_DATA_CHANNELS.conversationPresenceChanged, listener)
    },
  },
  auth: {
    getServer: () => ipcRenderer.invoke(AUTH_CHANNELS.getServer),
    getServers: () => ipcRenderer.invoke(AUTH_CHANNELS.getServers),
    restoreLastSession: () => ipcRenderer.invoke(AUTH_CHANNELS.restoreLastSession),
    saveServer: (input) => ipcRenderer.invoke(AUTH_CHANNELS.saveServer, input),
    deleteServer: (id) => ipcRenderer.invoke(AUTH_CHANNELS.deleteServer, id),
    checkServer: (id) => ipcRenderer.invoke(AUTH_CHANNELS.checkServer, id),
    checkServers: () => ipcRenderer.invoke(AUTH_CHANNELS.checkServers),
    connect: (input) => ipcRenderer.invoke(AUTH_CHANNELS.connect, input),
    signIn: (input) => ipcRenderer.invoke(AUTH_CHANNELS.signIn, input),
    signInThirdParty: (input) => ipcRenderer.invoke(AUTH_CHANNELS.signInThirdParty, input),
    sendCode: (input) => ipcRenderer.invoke(AUTH_CHANNELS.sendCode, input),
    signOut: (targetId) => ipcRenderer.invoke(AUTH_CHANNELS.signOut, targetId),
  },
}

contextBridge.exposeInMainWorld("desktop", bridge)
