import path from "node:path"
import { app, BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron"
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
  type SystemInfo,
} from "../shared/desktop"
import { AuthController, authResult } from "./auth-controller"
import { checkForUpdates, isTrustedReleaseUrl } from "./update-service"

// WSLg 的 Chromium GPU 黑名单会禁用 Shader Background 所需的 WebGL。
if (!app.isPackaged && process.platform === "linux" && process.env.WSL_DISTRO_NAME) {
  app.commandLine.appendSwitch("ignore-gpu-blocklist")
  app.commandLine.appendSwitch("enable-unsafe-swiftshader")
}

// 新客户端与旧版账号和配置隔离。
app.setPath("userData", path.join(app.getPath("appData"), "jiying-desktop-next"))

let mainWindow: BrowserWindow | null = null

function createWindow() {
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

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new AuthFailure("untrusted_sender", "窗口请求来源不受信任")
  }
}

void app.whenReady().then(() => {
  const auth = new AuthController(app.getPath("userData"))
  function handleIpc<T>(channel: string, operation: (input: unknown) => Promise<T>) {
    ipcMain.handle(channel, (event, input: unknown) =>
      authResult(async () => {
        assertTrustedSender(event)
        return operation(input)
      }),
    )
  }
  handleIpc(AUTH_CHANNELS.getServer, () => auth.getServer())
  handleIpc(AUTH_CHANNELS.getServers, () => auth.getServers())
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
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on("will-download", (event) => event.preventDefault())

  createWindow()
  app.on("activate", () => {
    if (!mainWindow) createWindow()
  })
})

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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
