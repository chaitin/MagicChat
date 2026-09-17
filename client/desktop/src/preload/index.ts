import { contextBridge, ipcRenderer } from "electron"
import { ACCOUNT_DATA_CHANNELS } from "../shared/account-data"
import { DESKTOP_CHANNELS, type DesktopBridge } from "../shared/desktop"
import { AUTH_CHANNELS } from "../shared/auth"
import { MEDIA_CHANNELS, type MediaDownloadProgress } from "../shared/media"

const platform =
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"

const bridge: DesktopBridge = {
  openHomepage: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openHomepage),
  openExternalLink: (url) => ipcRenderer.invoke(DESKTOP_CHANNELS.openExternalLink, url),
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
  windowControls: {
    platform,
    getMaximized: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowGetState),
    minimize: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowToggleMaximize),
    close: () => ipcRenderer.invoke(DESKTOP_CHANNELS.windowClose),
    onMaximizedChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        callback(maximized)
      ipcRenderer.on(DESKTOP_CHANNELS.windowMaximizedChanged, listener)
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.windowMaximizedChanged, listener)
    },
  },
  media: {
    ensureCached: (input) => ipcRenderer.invoke(MEDIA_CHANNELS.ensureCached, input),
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
    listConversations: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listConversations, targetId),
    listMessages: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listMessages, input),
    loadBeforeMessages: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.loadBeforeMessages, input),
    sendTextMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendTextMessage, input),
    selectMessageFile: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.selectMessageFile, targetId),
    selectMessageMedia: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.selectMessageMedia, input),
    sendFileMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendFileMessage, input),
    sendImageMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendImageMessage, input),
    sendVideoMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.sendVideoMessage, input),
    retryMessage: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.retryMessage, input),
    setMessageReaction: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.setMessageReaction, input),
    listMessageReactionUsers: (input) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listMessageReactionUsers, input),
    getContacts: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.getContacts, targetId),
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
