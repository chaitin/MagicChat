import { lstat, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron"
import { ACCOUNT_DATA_CHANNELS } from "../shared/account-data"
import { AuthFailure } from "../shared/auth"
import {
  DESKTOP_CHANNELS,
  EXTERNAL_LINKS,
  isSafeWebUrl,
  JIYING_HOMEPAGE,
  type NotificationSettings,
  type ShortcutSettings,
  type StorageInfo,
  type StorageUsage,
  type SystemInfo,
  type ThemePreference,
} from "../shared/desktop"
import { MEDIA_CHANNELS } from "../shared/media"
import { SCREENSHOT_CHANNELS, type ScreenshotSelection } from "../shared/screenshot"
import { AuthController, authResult } from "./auth-controller"
import { registerAccountDataIpc } from "./ipc/register-account-data-ipc"
import { registerAuthIpc } from "./ipc/register-auth-ipc"
import { registerContactIpc } from "./ipc/register-contact-ipc"
import { registerMediaIpc } from "./ipc/register-media-ipc"
import { decodePreviewImage } from "./media-preview-image-decoder"
import { MediaPreviewWindow } from "./media-preview-window"
import { SelectedMessageFileStore } from "./message-files/selected-message-file-store"
import {
  registerPrivilegedSchemes,
  registerResourceProtocolHandlers,
} from "./protocols/resource-protocols"
import { ScreenshotManager } from "./screenshot-manager"
import { ShortcutManager } from "./shortcut-manager"
import { checkForUpdates, isTrustedReleaseUrl } from "./update-service"

// WSLg 不会稳定继承 Windows 的 DPI，且硬件视频合成可能只播放声音而显示黑屏。
if (!app.isPackaged && process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  app.commandLine.appendSwitch("force-device-scale-factor", "1.5")
  app.disableHardwareAcceleration()
}

registerPrivilegedSchemes()

// 新客户端与旧版账号和配置隔离。
app.setPath("userData", path.join(app.getPath("appData"), "jiying-desktop-next"))

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow() {
  if (mainWindow) return
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "即应",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 8, y: 9 },
        }
      : { frame: false }),
    backgroundColor: "#f8f9fb",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  mainWindow = window
  window.removeMenu()
  window.once("ready-to-show", () => window.show())
  window.on("close", (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.on("closed", () => {
    mainWindow = null
  })
  const sendMaximizedState = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(DESKTOP_CHANNELS.windowMaximizedChanged, window.isMaximized())
    }
  }
  window.on("maximize", sendMaximizedState)
  window.on("unmaximize", sendMaximizedState)
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && developmentUrl) {
    const url = new URL(developmentUrl)
    if (url.origin !== "http://127.0.0.1:20110") throw new Error("开发页面地址不受信任")
    void window.loadURL(url.href)
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
}

function openSettings() {
  showMainWindow()
  mainWindow?.webContents.send(DESKTOP_CHANNELS.openSettings)
}

function requestSignOut() {
  showMainWindow()
  mainWindow?.webContents.send(DESKTOP_CHANNELS.requestSignOut)
}

function requestQuit() {
  showMainWindow()
  mainWindow?.webContents.send(DESKTOP_CHANNELS.requestQuit)
}

function quitApp() {
  isQuitting = true
  app.quit()
}

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "tray-icon.png")
    : path.join(__dirname, "../../resources/icon.png")
  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) throw new Error("无法加载托盘图标")
  const size = process.platform === "darwin" ? 18 : 16
  tray = new Tray(source.resize({ width: size, height: size }))
  tray.setToolTip("即应")
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开即应",
        icon: createTrayMenuIcon("open"),
        click: showMainWindow,
      },
      {
        label: "设置",
        icon: createTrayMenuIcon("settings"),
        click: openSettings,
      },
      { type: "separator" },
      {
        label: "退出登录",
        icon: createTrayMenuIcon("signOut"),
        click: requestSignOut,
      },
      {
        label: "关闭即应",
        icon: createTrayMenuIcon("quit"),
        click: requestQuit,
      },
    ]),
  )
  tray.on("double-click", showMainWindow)
}

function createTrayMenuIcon(type: "open" | "settings" | "signOut" | "quit") {
  const color = type === "signOut" || type === "quit" ? "#fa5151" : "#7d7d7d"
  const graphic =
    type === "open"
      ? `<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M5 7.5h6M8 5v5"/>`
      : type === "settings"
        ? `<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"/>`
        : type === "signOut"
          ? `<path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H7M9.5 5l3 3-3 3M6 8h6.5"/>`
          : `<path d="M8 2v6M4.5 3.8a6 6 0 1 0 7 0"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${graphic}</svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  )
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
  }
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (app.isReady()) showMainWindow()
    else void app.whenReady().then(showMainWindow)
  })
}

void app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const auth = new AuthController(app.getPath("userData"), {
    onSyncStateChange: (event) =>
      mainWindow?.webContents.send(ACCOUNT_DATA_CHANNELS.syncStateChanged, event),
    onDataChanged: (event) => mainWindow?.webContents.send(ACCOUNT_DATA_CHANNELS.changed, event),
    onMediaProgress: (event) =>
      mainWindow?.webContents.send(MEDIA_CHANNELS.downloadProgress, event),
  })
  const mediaPreview = new MediaPreviewWindow(
    path.join(__dirname, "../preload/mediaPreview.cjs"),
    path.join(__dirname, "../renderer/index.html"),
    !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
  )
  const screenshot = new ScreenshotManager(
    path.join(__dirname, "../preload/screenshot.cjs"),
    path.join(__dirname, "../renderer/index.html"),
    !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
  )
  const selectedMessageFiles = new SelectedMessageFileStore(app.getPath("userData"))
  const shortcuts = new ShortcutManager(showMainWindow, () => screenshot.capture())
  try {
    shortcuts.update((await auth.getAppSettings()).shortcuts)
  } catch (error) {
    console.warn("无法注册全局快捷键", error)
  }
  registerResourceProtocolHandlers(auth, selectedMessageFiles)
  function handleIpc<T>(channel: string, operation: (input: unknown) => Promise<T>) {
    ipcMain.handle(channel, (event, input: unknown) =>
      authResult(async () => {
        assertTrustedSender(event)
        return operation(input)
      }),
    )
  }
  function windowForControl(event: IpcMainInvokeEvent) {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (
      !window ||
      event.senderFrame !== event.sender.mainFrame ||
      (window !== mainWindow && !mediaPreview.ownsSender(event.sender))
    ) {
      throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
    }
    return window
  }
  ipcMain.handle(DESKTOP_CHANNELS.windowGetState, (event) => windowForControl(event).isMaximized())
  ipcMain.handle(DESKTOP_CHANNELS.windowMinimize, (event) => {
    windowForControl(event).minimize()
  })
  ipcMain.handle(DESKTOP_CHANNELS.windowToggleMaximize, (event) => {
    const window = windowForControl(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.handle(DESKTOP_CHANNELS.windowClose, (event) => {
    windowForControl(event).close()
  })
  ipcMain.handle(DESKTOP_CHANNELS.windowQuit, (event) => {
    assertTrustedSender(event)
    quitApp()
  })
  ipcMain.handle(MEDIA_CHANNELS.previewInitialize, (event) => {
    if (event.senderFrame !== event.sender.mainFrame || !mediaPreview.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
    }
    return mediaPreview.getPayload(event.sender)
  })
  ipcMain.handle(MEDIA_CHANNELS.previewGetTheme, (event) => {
    if (event.senderFrame !== event.sender.mainFrame || !mediaPreview.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
    }
    return auth.getAppSettings().then((settings) => settings.theme)
  })
  async function currentPreviewFile(event: IpcMainInvokeEvent) {
    if (event.senderFrame !== event.sender.mainFrame || !mediaPreview.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
    }
    const source = mediaPreview.getSource(event.sender)
    const payload = mediaPreview.getPayload(event.sender)
    const filePath =
      source.kind === "cached"
        ? (await auth.getCachedMediaResource(source.targetId, source.cacheKey)).filePath
        : source.kind === "outgoing"
          ? (await auth.getOutgoingMedia(source.targetId, source.clientMessageId)).filePath
          : await auth.getAvatarResourceFilePath(source.targetId, source.resourceKey)
    const file = await stat(filePath).catch(() => null)
    if (!file?.isFile()) throw new AuthFailure("media_not_found", "媒体文件不存在")
    if (mediaPreview.getSource(event.sender) !== source) {
      throw new AuthFailure("preview_changed", "预览内容已更换，请重试")
    }
    return { payload, source, filePath, sizeBytes: file.size }
  }
  ipcMain.handle(MEDIA_CHANNELS.previewRevealCurrent, (event) =>
    authResult(async () => {
      const { filePath } = await currentPreviewFile(event)
      shell.showItemInFolder(filePath)
      return null
    }),
  )
  ipcMain.handle(MEDIA_CHANNELS.previewCopyImage, (event) =>
    authResult(async () => {
      const { payload, source, filePath, sizeBytes } = await currentPreviewFile(event)
      if (payload.category !== "image") {
        throw new AuthFailure("unsupported_media_copy", "仅图片支持复制")
      }
      if (sizeBytes > 20 * 1024 * 1024) {
        throw new AuthFailure("media_too_large", "图片过大，无法复制")
      }
      const bytes = await readFile(filePath)
      const image = await decodePreviewImage(bytes, payload.contentType)
      const { width, height } = image.getSize()
      if (width * height > 25_000_000) {
        throw new AuthFailure("media_too_large", "图片尺寸过大，无法复制")
      }
      if (mediaPreview.getSource(event.sender) !== source) {
        throw new AuthFailure("preview_changed", "预览内容已更换，请重试")
      }
      clipboard.writeImage(image)
      return null
    }),
  )
  ipcMain.handle(SCREENSHOT_CHANNELS.initialize, (event) => {
    if (!screenshot.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "截图请求来源不受信任")
    }
    return screenshot.getPayload()
  })
  ipcMain.handle(SCREENSHOT_CHANNELS.complete, (event, input: unknown) => {
    if (!screenshot.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "截图请求来源不受信任")
    }
    screenshot.complete(input as ScreenshotSelection)
  })
  ipcMain.handle(SCREENSHOT_CHANNELS.cancel, (event) => {
    if (!screenshot.ownsSender(event.sender)) {
      throw new AuthFailure("untrusted_sender", "截图请求来源不受信任")
    }
    screenshot.cancel()
  })
  registerMediaIpc({ handle: handleIpc, auth, mediaPreview })
  registerAccountDataIpc({
    handle: handleIpc,
    auth,
    selectedMessageFiles,
    getMainWindow: () => mainWindow,
  })
  registerContactIpc({
    handle: handleIpc,
    operations: {
      refreshContacts: (targetId) => auth.refreshContacts(targetId),
      searchContactUsers: (input) => auth.searchContactUsers(input),
      listFriendRequests: (input) => auth.listFriendRequests(input),
      createFriendRequest: (input) => auth.mutateFriendRequest("create", input),
      acceptFriendRequest: (input) => auth.mutateFriendRequest("accept", input),
      rejectFriendRequest: (input) => auth.mutateFriendRequest("reject", input),
      cancelFriendRequest: (input) => auth.mutateFriendRequest("cancel", input),
      deleteFriend: (input) => auth.deleteFriend(input),
      openContactConversation: (input) => auth.openContactConversation(input),
      createClientApp: (input) => auth.createClientApp(input),
      getClientApp: (input) => auth.getClientApp(input),
      updateClientApp: (input) => auth.updateClientApp(input),
      deleteClientApp: (input) => auth.deleteClientApp(input),
      regenerateClientAppSecret: (input) => auth.regenerateClientAppSecret(input),
      selectClientAppAvatar: async (targetId) => {
        const parent = mainWindow
        if (!parent) throw new AuthFailure("window_unavailable", "主窗口不可用")
        return selectedMessageFiles.selectAppAvatar(targetId, parent)
      },
      uploadClientAppAvatar: async (input) => {
        const selected = selectedMessageFiles.getMedia(
          input.selectionToken,
          input.targetId,
          "image",
          "invalid_image_selection",
        )
        await selectedMessageFiles.assertUnchanged(
          selected,
          "image_changed",
          "所选图片已发生变化，请重新选择",
        )
        const app = await auth.uploadClientAppAvatar(
          { targetId: input.targetId, id: input.appId },
          {
            path: selected.path,
            name: selected.name,
            contentType: selected.contentType ?? "application/octet-stream",
          },
        )
        selectedMessageFiles.delete(input.selectionToken)
        return app
      },
    },
  })
  registerAuthIpc({
    handle: handleIpc,
    auth,
    getMainWindow: () => mainWindow,
  })
  handleIpc(DESKTOP_CHANNELS.openHomepage, async () => {
    await shell.openExternal(JIYING_HOMEPAGE)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.openExternalLink, async (input) => {
    if (
      typeof input !== "string" ||
      (!(EXTERNAL_LINKS as readonly string[]).includes(input) && !isTrustedReleaseUrl(input))
    ) {
      throw new AuthFailure("invalid_external_link", "外部链接不受信任")
    }
    await shell.openExternal(input)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.openWebLink, async (input) => {
    if (!isSafeWebUrl(input)) {
      throw new AuthFailure("invalid_web_link", "网页链接不正确")
    }
    await shell.openExternal(input)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.copyText, async (input) => {
    if (typeof input !== "string" || !input || input.length > 1_000_000) {
      throw new AuthFailure("invalid_clipboard_text", "复制内容不正确")
    }
    clipboard.writeText(input)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.checkForUpdates, () => checkForUpdates())
  handleIpc(DESKTOP_CHANNELS.getSystemInfo, async () => getSystemInfo())
  handleIpc(DESKTOP_CHANNELS.getStorageInfo, async () => getStorageInfo())
  handleIpc(DESKTOP_CHANNELS.openStorageDirectory, async () => {
    const error = await shell.openPath(app.getPath("userData"))
    if (error) throw new AuthFailure("storage_open_failed", "无法打开应用存储目录")
    return null
  })
  handleIpc(DESKTOP_CHANNELS.calculateStorageUsage, async () => calculateStorageUsage())
  handleIpc(DESKTOP_CHANNELS.getAppSettings, () => auth.getAppSettings())
  handleIpc(DESKTOP_CHANNELS.setTheme, async (input) => {
    const theme = input as ThemePreference
    await auth.setTheme(theme)
    mediaPreview.notifyThemeChanged(theme)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.setNotificationSettings, async (input) => {
    await auth.setNotificationSettings(input as NotificationSettings)
    return null
  })
  handleIpc(DESKTOP_CHANNELS.setShortcutSettings, async (input) => {
    const settings = input as ShortcutSettings
    const previous = shortcuts.getSettings()
    shortcuts.update(settings)
    try {
      await auth.setShortcutSettings(settings)
    } catch (error) {
      shortcuts.update(previous)
      throw error
    }
    return null
  })
  handleIpc(DESKTOP_CHANNELS.setShortcutRecording, async (input) => {
    if (typeof input !== "boolean") {
      throw new AuthFailure("invalid_shortcut_recording", "快捷键录入状态不正确")
    }
    shortcuts.setRecording(input)
    return null
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on("will-download", (event) => event.preventDefault())

  createWindow()
  createTray()
  app.on("activate", showMainWindow)
  app.once("before-quit", () => {
    shortcuts.close()
    screenshot.close()
    mediaPreview.close()
    auth.close()
  })
})

function getStorageInfo(): StorageInfo {
  return { directoryPath: app.getPath("userData") }
}

async function calculateStorageUsage(): Promise<StorageUsage> {
  const root = app.getPath("userData")
  const directories = [root]
  let bytes = 0
  while (directories.length > 0) {
    const directory = directories.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      if (directory === root) {
        throw new AuthFailure("storage_unavailable", "无法读取应用存储目录")
      }
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        directories.push(entryPath)
      } else if (entry.isFile()) {
        try {
          bytes += (await lstat(entryPath)).size
        } catch {
          // 计算期间被删除或暂时不可访问的文件不计入总量。
        }
      }
    }
  }
  return { bytes }
}

function getSystemInfo(): SystemInfo {
  const type =
    process.platform === "win32"
      ? "Windows"
      : process.platform === "darwin"
        ? "macOS"
        : process.platform === "linux"
          ? "Linux"
          : null
  if (!type) throw new AuthFailure("unsupported_platform", "无法识别当前操作系统")
  return { type, version: process.getSystemVersion(), architecture: process.arch }
}

app.on("before-quit", () => {
  isQuitting = true
  tray?.destroy()
  tray = null
})
