import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron"
import { ACCOUNT_DATA_CHANNELS, type AvatarRequest } from "../shared/account-data"
import {
  AUTH_CHANNELS,
  AuthFailure,
  type SaveServerInput,
  type SignInInput,
  type ThirdPartySignInInput,
} from "../shared/auth"
import {
  DESKTOP_CHANNELS,
  EXTERNAL_LINKS,
  JIYING_HOMEPAGE,
  type NotificationSettings,
  type ShortcutSettings,
  type StorageInfo,
  type StorageUsage,
  type SystemInfo,
  type ThemePreference,
} from "../shared/desktop"
import { SCREENSHOT_CHANNELS, type ScreenshotSelection } from "../shared/screenshot"
import { AuthController, authResult } from "./auth-controller"
import { ScreenshotManager } from "./screenshot-manager"
import { ShortcutManager } from "./shortcut-manager"
import { checkForUpdates, isTrustedReleaseUrl } from "./update-service"

// WSLg 的 Chromium GPU 黑名单会禁用 Shader Background 所需的 WebGL。
if (!app.isPackaged && process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  app.commandLine.appendSwitch("ignore-gpu-blocklist")
  app.commandLine.appendSwitch("enable-unsafe-swiftshader")
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "jiying-avatar",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

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
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    title: "即应",
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
      { label: "显示窗口", click: showMainWindow },
      { type: "separator" },
      {
        label: "退出即应",
        click: () => {
          isQuitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on("double-click", showMainWindow)
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
  const auth = new AuthController(app.getPath("userData"))
  const screenshot = new ScreenshotManager(
    path.join(__dirname, "../preload/screenshot.cjs"),
    path.join(__dirname, "../renderer/index.html"),
    !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
  )
  const shortcuts = new ShortcutManager(showMainWindow, () => screenshot.capture())
  try {
    shortcuts.update((await auth.getAppSettings()).shortcuts)
  } catch (error) {
    console.warn("无法注册全局快捷键", error)
  }
  protocol.handle("jiying-avatar", async (request) => {
    try {
      const url = new URL(request.url)
      const resourceKey = url.hostname === "cache" ? url.pathname.slice(1) : ""
      const resource = await auth.readAvatarResource(resourceKey)
      const body = resource.bytes.buffer.slice(
        resource.bytes.byteOffset,
        resource.bytes.byteOffset + resource.bytes.byteLength,
      ) as ArrayBuffer
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": resource.contentType,
          "Cache-Control": "public, max-age=86400, immutable",
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
  function handleIpc<T>(channel: string, operation: (input: unknown) => Promise<T>) {
    ipcMain.handle(channel, (event, input: unknown) =>
      authResult(async () => {
        assertTrustedSender(event)
        return operation(input)
      }),
    )
  }
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
  handleIpc(ACCOUNT_DATA_CHANNELS.initialize, (input) =>
    auth.initializeAccountData(input as string),
  )
  handleIpc(ACCOUNT_DATA_CHANNELS.listConversations, (input) =>
    auth.listConversations(input as string),
  )
  handleIpc(ACCOUNT_DATA_CHANNELS.listMessages, (input) => {
    const value = input as { targetId?: string; conversationId?: string } | undefined
    return auth.listMessages(value?.targetId ?? "", value?.conversationId ?? "")
  })
  handleIpc(ACCOUNT_DATA_CHANNELS.getContacts, (input) => auth.getContacts(input as string))
  handleIpc(ACCOUNT_DATA_CHANNELS.getAvatar, (input) => auth.getAvatar(input as AvatarRequest))
  handleIpc(ACCOUNT_DATA_CHANNELS.invalidateAvatar, (input) =>
    auth.invalidateAvatar(input as Omit<AvatarRequest, "theme">),
  )
  handleIpc(AUTH_CHANNELS.getServer, () => auth.getServer())
  handleIpc(AUTH_CHANNELS.getServers, () => auth.getServers())
  handleIpc(AUTH_CHANNELS.restoreLastSession, () => auth.restoreLastSession())
  handleIpc(AUTH_CHANNELS.saveServer, (input) => auth.saveServer(input as SaveServerInput))
  handleIpc(AUTH_CHANNELS.deleteServer, (input) => auth.deleteServer(input as string))
  handleIpc(AUTH_CHANNELS.checkServer, (input) => auth.checkServer(input as string))
  handleIpc(AUTH_CHANNELS.checkServers, () => auth.checkServers())
  handleIpc(AUTH_CHANNELS.connect, (input) => auth.connect(input as string))
  handleIpc(AUTH_CHANNELS.signIn, (input) => auth.signIn(input as SignInInput))
  handleIpc(AUTH_CHANNELS.signInThirdParty, (input) => {
    if (!mainWindow) throw new AuthFailure("window_unavailable", "主窗口不可用，请重试")
    return auth.signInThirdParty(input as ThirdPartySignInInput, mainWindow)
  })
  handleIpc(AUTH_CHANNELS.sendCode, (input) =>
    auth.sendCode(input as { targetId: string; email: string }),
  )
  handleIpc(AUTH_CHANNELS.signOut, (input) => auth.signOut(input as string))
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
    await auth.setTheme(input as ThemePreference)
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
