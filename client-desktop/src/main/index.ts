import path from "node:path"
import { app, dialog, nativeTheme, powerMonitor, screen } from "electron"
import { IPC } from "@shared/bridge"
import { AuthController } from "@main/auth-controller"
import { ASRController } from "@main/asr-controller"
import {
  APP_DISPLAY_NAME,
  stableUserDataPath,
  STABLE_APP_ID,
  STABLE_UPDATER_CACHE_DIRECTORY_NAME,
} from "@main/app-identity"
import { DocumentCollaborationController } from "@main/document-collaboration-controller"
import { DocumentWindowManager } from "@main/document-window-manager"
import { FileDocumentWindowStateStore } from "@main/document-window-state"
import { ConfigStore } from "@main/config-store"
import { CredentialStore } from "@main/credential-store"
import { Diagnostics } from "@main/diagnostics"
import { desktopBuild } from "@main/desktop-build"
import { normalizeDiagnosticProcessExitReason } from "@shared/diagnostics-contract"
import { parseDeepLink } from "@main/deep-links"
import { FileService } from "@main/file-service"
import { HttpTransport } from "@main/http-transport"
import { registerIpc } from "@main/ipc"
import { installLocalProtocol, registerPrivilegedSchemes } from "@main/local-protocol"
import { NotificationService } from "@main/notification-service"
import { MessageCacheService } from "@main/message-cache"
import { RealtimeController } from "@main/realtime-controller"
import { ProxyAuthPrompt } from "@main/proxy-auth"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"
import { runtimeIconPath, runtimeTrayIconPath, SystemIntegration } from "@main/system-integration"
import { UpdaterService } from "@main/updater-service"
import { StreamingUploadController } from "@main/streaming-upload"
import { prepareUpdateInstall } from "@main/update-install-lifecycle"
import { StartupHealth } from "@main/startup-health"
import { isMainApplicationUrl, WindowController } from "@main/window-controller"
import { ScreenshotController } from "@main/screenshot-controller"
import { ShortcutManager } from "@main/shortcut-manager"
import { StorageService } from "@main/storage-service"
import { UpdateCacheLifecycle } from "@main/update-cache-lifecycle"
import messageCacheWorkerPath from "@main/message-cache/message-cache-worker?modulePath"

app.setPath("userData", stableUserDataPath(app.getPath("appData")))
registerPrivilegedSchemes()

const initialDeepLink = process.argv.find((value) => value.startsWith("magicchat://"))
const singleInstance = app.requestSingleInstanceLock({ deepLink: initialDeepLink })
if (!singleInstance) app.quit()
else
  void start().catch(async (error: unknown) => {
    await app.whenReady()
    dialog.showErrorBox(
      `${APP_DISPLAY_NAME} 无法启动`,
      error instanceof Error ? error.message : "桌面客户端初始化失败",
    )
    app.exit(1)
  })

async function start(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId(STABLE_APP_ID)
  registerProtocolClient()
  const diagnostics = new Diagnostics(app.getPath("userData"))
  await diagnostics.initialize()
  const startupHealth = new StartupHealth(app.getPath("userData"), app.getVersion())
  const healthResult = await startupHealth.begin()
  if (healthResult.previousStartupIncomplete)
    await diagnostics.recordEvent({ origin: "main", type: "application.startup-incomplete" })
  const store = new ConfigStore(app.getPath("userData"))
  await store.load()
  const profiles = new ServerProfiles(store)
  const messageCache = new MessageCacheService(
    app.getPath("userData"),
    messageCacheWorkerPath,
    profiles,
  )
  await messageCache.initialize().catch(() => undefined)
  const sessions = new SessionController(app.getPath("userData"))
  installLocalProtocol(path.resolve(__dirname, "../renderer"), profiles, sessions)
  const files = new FileService(profiles, sessions)
  const credentials = new CredentialStore(path.join(app.getPath("userData"), "credentials"))
  const iconPath = runtimeIconPath()
  const trayIconPath = runtimeTrayIconPath()
  const windows = new WindowController(
    store,
    diagnostics,
    path.resolve(__dirname, "../preload/index.cjs"),
    iconPath,
  )
  const captureRendererUrl =
    !app.isPackaged && process.env.ELECTRON_RENDERER_URL
      ? new URL("capture.html", process.env.ELECTRON_RENDERER_URL).toString()
      : "magicchat-app://app/capture.html"
  const screenshots = new ScreenshotController({
    capturePreloadPath: path.resolve(__dirname, "../preload/index.cjs"),
    captureUrl: captureRendererUrl,
    getMainWindow: () => windows.current(),
    onConversationResult: (result) => windows.send(IPC.screenshotCompleted, result),
  })
  screenshots.installProtocol()
  const unregisterScreenshotIpc = screenshots.registerIpc()
  const proxyAuth = new ProxyAuthPrompt(windows, iconPath)
  const realtime = new RealtimeController(profiles, sessions, proxyAuth, diagnostics)
  const asr = new ASRController(profiles, sessions, proxyAuth)
  const documentCollaboration = new DocumentCollaborationController(profiles, sessions, proxyAuth)
  const documentWindowState = new FileDocumentWindowStateStore(app.getPath("userData"))
  await documentWindowState.load().catch(() => {
    void diagnostics.recordEvent({
      origin: "main",
      type: "application.document-window-state-load-failed",
    })
  })
  const documentWindows = new DocumentWindowManager({
    collaboration: documentCollaboration,
    diagnostics,
    developmentUrl: process.env.ELECTRON_RENDERER_URL,
    getMainWindow: () => windows.current(),
    iconPath,
    initialDarkTheme: nativeTheme.shouldUseDarkColors,
    preloadPath: path.resolve(__dirname, "../preload/index.cjs"),
    profiles,
    state: documentWindowState,
    store,
  })
  const system = new SystemIntegration(store, windows, process.platform, [documentWindows])
  const trayAvailable = system.createTray(trayIconPath)
  if (
    !trayAvailable &&
    process.platform !== "darwin" &&
    store.getSettings().closeBehavior === "background"
  )
    await store.setSettings({ closeBehavior: "quit" })
  system.configurePermissions()
  const auth = new AuthController(
    profiles,
    sessions,
    (result) => windows.send(IPC.authFinished, result),
    () => windows.current(),
    iconPath,
    { onUserChanged: (serverId) => documentWindows.closeServer(serverId) },
  )
  const notifications = new NotificationService(
    () => store.getSettings(),
    async (input) => {
      const profile = profiles.require(input.target.id)
      const response = await sessions
        .for(profile)
        .fetch(`${profile.normalizedUrl}/api/client/me`, { credentials: "include" })
      if (!response.ok) return
      await store.setSettings({ selectedServerId: profile.id })
      await windows.verifyAndNavigate(
        `/chat/${encodeURIComponent(input.conversationId)}${input.messageId ? `?message=${encodeURIComponent(input.messageId)}` : ""}`,
      )
    },
    { iconPath, platform: process.platform },
  )
  const http = new HttpTransport(profiles, sessions, {
    onUserChanged: (serverId) => documentWindows.closeServer(serverId),
  })
  const uploads = new StreamingUploadController(profiles, sessions)
  const updateCache = new UpdateCacheLifecycle({
    currentBuild: desktopBuild(),
    currentVersion: app.getVersion(),
    updaterCachePath: updaterCachePath(),
    userDataPath: app.getPath("userData"),
  })
  const updater = new UpdaterService({
    discardInstallIntent: () => updateCache.discardInstallIntent(),
    hasActiveTransfers: () => files.hasActiveTransfers() || uploads.hasActiveTransfers(),
    prepareInstall: () => prepareUpdateInstall({ documentWindows, messageCache, windows }),
    recordInstallIntent: (targetVersion, targetBuild) =>
      updateCache.recordInstallIntent(targetVersion, targetBuild),
    updaterCachePath: updaterCachePath(),
  })
  const storage = new StorageService({
    installationPath: appInstallationPath(),
    sessions,
    updateCache,
    updater,
    updaterCachePath: updaterCachePath(),
    userDataPath: app.getPath("userData"),
  })
  const shortcuts = new ShortcutManager({
    diagnostics,
    screenshots,
    store,
    windows,
  })
  const unregisterIpc = registerIpc({
    auth,
    asr,
    credentials,
    diagnostics,
    documentCollaboration,
    documentWindows,
    files,
    http,
    messageCache,
    notifications,
    profiles,
    realtime,
    sessions,
    shortcuts,
    storage,
    store,
    system,
    updater,
    uploads,
  })

  const hidden = process.argv.includes("--hidden") && store.getSettings().autoLaunch
  const mainWindow = windows.create(hidden)
  const recordWindowState = () => {
    const episodeId = diagnostics.getCurrentEpisodeId()
    void diagnostics.recordEvent({
      ...(episodeId ? { context: { episodeId } } : {}),
      data: {
        windowFocused: mainWindow.isFocused(),
        windowMinimized: mainWindow.isMinimized(),
        windowVisible: mainWindow.isVisible(),
      },
      origin: "main",
      type: "environment.window-state-changed",
    })
  }
  mainWindow.on("show", recordWindowState)
  mainWindow.on("hide", recordWindowState)
  mainWindow.on("focus", recordWindowState)
  mainWindow.on("blur", recordWindowState)
  mainWindow.on("minimize", recordWindowState)
  mainWindow.on("restore", recordWindowState)
  shortcuts.start()
  const cancelScreenshotForDisplayChange = () => screenshots.cancelActive()
  screen.on("display-added", cancelScreenshotForDisplayChange)
  screen.on("display-removed", cancelScreenshotForDisplayChange)
  screen.on("display-metrics-changed", cancelScreenshotForDisplayChange)
  const markHealthyOnMainApplicationLoad = () => {
    if (!isMainApplicationUrl(mainWindow.webContents.getURL(), app.isPackaged)) return
    mainWindow.webContents.removeListener("did-finish-load", markHealthyOnMainApplicationLoad)
    void markStartupHealthy({ startupHealth, updateCache })
  }
  mainWindow.webContents.on("did-finish-load", markHealthyOnMainApplicationLoad)
  powerMonitor.on("suspend", () => {
    diagnostics.createEpisode("suspend")
    asr.closeAll()
    documentCollaboration.closeAll()
  })
  powerMonitor.on("resume", () => realtime.reconnectAll(diagnostics.createEpisode("resume")))
  powerMonitor.on("lock-screen", () => diagnostics.createEpisode("locked"))
  powerMonitor.on("unlock-screen", () => realtime.reconnectAll(diagnostics.createEpisode("resume")))
  app.on("activate", () => {
    diagnostics.createEpisode("window")
    windows.show()
  })
  app.on("second-instance", (_event, argv, _workingDirectory, additionalData) => {
    const data = additionalData as { deepLink?: unknown }
    const link =
      typeof data.deepLink === "string"
        ? data.deepLink
        : argv.find((value) => value.startsWith("magicchat://"))
    if (link) void handleDeepLink(link)
    else windows.show()
  })
  app.on("open-url", (event, url) => {
    event.preventDefault()
    void handleDeepLink(url)
  })
  app.on("login", (event, _webContents, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return
    event.preventDefault()
    proxyAuth.show(callback, authInfo.host)
  })
  let quitState: "idle" | "preparing" | "ready" = "idle"
  let transferExitConfirmed = false
  app.on("before-quit", (event) => {
    if (updater.isInstallIntent()) {
      screenshots.dispose()
      windows.prepareToQuit()
      http.cancelAll()
      asr.closeAll()
      documentWindows.dispose()
      documentCollaboration.shutdown()
      auth.dispose()
      realtime.closeAll()
      void files.cleanup()
      return
    }
    if (quitState === "ready") return
    event.preventDefault()
    if (quitState === "preparing") return
    if (!transferExitConfirmed && (files.hasActiveTransfers() || uploads.hasActiveTransfers())) {
      const choice = dialog.showMessageBoxSync({
        type: "warning",
        buttons: ["继续传输", "取消传输并退出"],
        cancelId: 0,
        defaultId: 0,
        message: "仍有文件传输正在进行",
      })
      if (choice === 0) return
      transferExitConfirmed = true
    }
    quitState = "preparing"
    void documentWindows.requestCloseAll().then((confirmed) => {
      if (!confirmed) {
        quitState = "idle"
        transferExitConfirmed = false
        windows.cancelPrepareToQuit()
        return
      }
      screenshots.dispose()
      windows.prepareToQuit()
      http.cancelAll()
      asr.closeAll()
      documentWindows.dispose()
      documentCollaboration.shutdown()
      auth.dispose()
      realtime.closeAll()
      void Promise.all([files.cleanup(), messageCache.close()]).finally(() => {
        updater.dispose()
        quitState = "ready"
        app.quit()
      })
    })
  })
  app.once("will-quit", () => {
    unregisterIpc()
    unregisterScreenshotIpc()
    shortcuts.dispose()
    screen.removeListener("display-added", cancelScreenshotForDisplayChange)
    screen.removeListener("display-removed", cancelScreenshotForDisplayChange)
    screen.removeListener("display-metrics-changed", cancelScreenshotForDisplayChange)
    screenshots.dispose()
    documentWindows.dispose()
    system.dispose()
    updater.dispose()
  })
  process.on(
    "uncaughtException",
    () => void diagnostics.recordEvent({ origin: "main", type: "application.uncaught-exception" }),
  )
  process.on(
    "unhandledRejection",
    () => void diagnostics.recordEvent({ origin: "main", type: "application.unhandled-rejection" }),
  )
  app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU")
      void diagnostics.recordEvent({
        data: { processExitReason: normalizeDiagnosticProcessExitReason(details.reason) },
        origin: "gpu",
        type: "gpu.process-error",
      })
  })
  if (initialDeepLink) await handleDeepLink(initialDeepLink)

  async function handleDeepLink(rawUrl: string): Promise<void> {
    try {
      const action = parseDeepLink(rawUrl, new Set(profiles.list().map((profile) => profile.id)))
      if (action.kind === "unknown-server") {
        const result = await dialog.showMessageBox({
          type: "question",
          buttons: ["取消", "添加服务器"],
          cancelId: 0,
          defaultId: 0,
          message: "此链接指向尚未配置的服务器",
          detail: `确认前 ${APP_DISPLAY_NAME} 不会向该服务器发送现有凭据。`,
        })
        if (result.response === 1)
          windows.send("desktop:v1:unknown-server", { serverId: action.serverId })
        return
      }
      await store.setSettings({ selectedServerId: action.serverId })
      await windows.verifyAndNavigate(
        `/chat/${encodeURIComponent(action.conversationId)}${action.messageId ? `?message=${encodeURIComponent(action.messageId)}` : ""}`,
      )
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        message: `无法打开 ${APP_DISPLAY_NAME} 链接`,
        detail: error instanceof Error ? error.message : "链接无效",
      })
    }
  }
}

async function markStartupHealthy(options: {
  startupHealth: StartupHealth
  updateCache: UpdateCacheLifecycle
}): Promise<void> {
  try {
    await options.startupHealth.markHealthy()
  } catch {
    return
  }
  await options.updateCache.clearAfterHealthyStart().catch(() => undefined)
}

function updaterCachePath(): string {
  const home = app.getPath("home")
  const parent =
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches")
      : process.platform === "win32"
        ? (process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"))
        : (process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"))
  return path.join(parent, STABLE_UPDATER_CACHE_DIRECTORY_NAME)
}

function appInstallationPath(): string | undefined {
  if (!app.isPackaged) return undefined
  if (process.platform === "linux" && process.env.APPIMAGE) return process.env.APPIMAGE
  const executable = app.getPath("exe")
  return process.platform === "darwin"
    ? path.resolve(path.dirname(executable), "../..")
    : path.dirname(executable)
}

function registerProtocolClient(): void {
  if (process.defaultApp && process.argv[1])
    app.setAsDefaultProtocolClient("magicchat", process.execPath, [path.resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient("magicchat")
}
