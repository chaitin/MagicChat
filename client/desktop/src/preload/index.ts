import { contextBridge, ipcRenderer } from "electron"
import { ACCOUNT_DATA_CHANNELS } from "../shared/account-data"
import { DESKTOP_CHANNELS, type DesktopBridge } from "../shared/desktop"
import { AUTH_CHANNELS } from "../shared/auth"

const bridge: DesktopBridge = {
  openHomepage: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openHomepage),
  openExternalLink: (url) => ipcRenderer.invoke(DESKTOP_CHANNELS.openExternalLink, url),
  checkForUpdates: () => ipcRenderer.invoke(DESKTOP_CHANNELS.checkForUpdates),
  getSystemInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getSystemInfo),
  getAppSettings: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getAppSettings),
  setTheme: (theme) => ipcRenderer.invoke(DESKTOP_CHANNELS.setTheme, theme),
  accountData: {
    initialize: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.initialize, targetId),
    listConversations: (targetId) =>
      ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listConversations, targetId),
    listMessages: (input) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.listMessages, input),
    getContacts: (targetId) => ipcRenderer.invoke(ACCOUNT_DATA_CHANNELS.getContacts, targetId),
  },
  auth: {
    getServer: () => ipcRenderer.invoke(AUTH_CHANNELS.getServer),
    getServers: () => ipcRenderer.invoke(AUTH_CHANNELS.getServers),
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
