import type {
  AuthenticatedTarget,
  ClientRequest,
  ClientResponse,
  RealtimeEnvelope,
  RealtimeSnapshot,
  ServerTarget,
} from "@shared/client-contract"
import type { MessageCacheBridge } from "@shared/message-cache-contract"
import type { ASRBridge } from "@shared/asr-contract"
import type { ScreenshotBridge } from "@shared/screenshot-contract"
import type { ShortcutBridge } from "@shared/shortcut-contract"
import type { DocumentCollaborationBridge } from "@shared/document-collaboration-contract"
import type {
  DocumentWindowDocumentType,
  DocumentWindowOpenResponse,
} from "@shared/document-window-contract"
import type {
  DesktopStorageStats,
  StorageCacheKind,
  StorageClearResult,
} from "@shared/storage-contract"
import type {
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticStorageStats,
} from "@shared/diagnostics-contract"

export const BRIDGE_VERSION = 1 as const

export const DESKTOP_TITLEBAR_HEIGHT = 40

export const MAX_TRAY_MESSAGES = 20

export const IPC = {
  appInfo: "desktop:v1:app-info",
  asrClose: "desktop:v1:asr-close",
  asrCommit: "desktop:v1:asr-commit",
  asrConnect: "desktop:v1:asr-connect",
  asrEvent: "desktop:v1:asr-event",
  asrSendFrame: "desktop:v1:asr-send-frame",
  appearanceThemeSet: "desktop:v1:appearance-theme-set",
  authCancel: "desktop:v1:auth-cancel",
  authFinished: "desktop:v1:auth-finished",
  authStart: "desktop:v1:auth-start",
  badgeSet: "desktop:v1:badge-set",
  trayMessagesSet: "desktop:v1:tray-messages-set",
  clipboardWritePng: "desktop:v1:clipboard-write-png",
  clipboardWriteText: "desktop:v1:clipboard-write-text",
  diagnosticsExport: "desktop:v1:diagnostics-export",
  diagnosticsEvent: "desktop:v1:diagnostics-event",
  diagnosticsRuntime: "desktop:v1:diagnostics-runtime",
  diagnosticsStorageClear: "desktop:v1:diagnostics-storage-clear",
  diagnosticsStorageGetStats: "desktop:v1:diagnostics-storage-get-stats",
  documentCollaborationCancel: "desktop:v1:document-collaboration-cancel",
  documentCollaborationClose: "desktop:v1:document-collaboration-close",
  documentCollaborationConnect: "desktop:v1:document-collaboration-connect",
  documentCollaborationEvent: "desktop:v1:document-collaboration-event",
  documentCollaborationSend: "desktop:v1:document-collaboration-send",
  documentWindowOpen: "desktop:v1:document-window-open",
  filesDownload: "desktop:v1:files-download",
  filesOpenLocation: "desktop:v1:files-open-location",
  filesPick: "desktop:v1:files-pick",
  filesUpload: "desktop:v1:files-upload",
  messageCacheClearConversation: "desktop:v1:message-cache-clear-conversation",
  messageCacheClearUser: "desktop:v1:message-cache-clear-user",
  messageCacheCommitAfter: "desktop:v1:message-cache-commit-after",
  messageCacheCommitBefore: "desktop:v1:message-cache-commit-before",
  messageCacheCommitLatest: "desktop:v1:message-cache-commit-latest",
  messageCacheGetById: "desktop:v1:message-cache-get-by-id",
  messageCacheGetStats: "desktop:v1:message-cache-get-stats",
  messageCacheGetSyncState: "desktop:v1:message-cache-get-sync-state",
  messageCacheListSyncStates: "desktop:v1:message-cache-list-sync-states",
  messageCacheReadAround: "desktop:v1:message-cache-read-around",
  messageCacheReadBefore: "desktop:v1:message-cache-read-before",
  messageCacheReadRecent: "desktop:v1:message-cache-read-recent",
  messageCacheRemoveMessage: "desktop:v1:message-cache-remove-message",
  messageCacheUpsert: "desktop:v1:message-cache-upsert",
  notificationShow: "desktop:v1:notification-show",
  navigate: "desktop:v1:navigate",
  openExternal: "desktop:v1:open-external",
  permissionsOpenSettings: "desktop:v1:permissions-open-settings",
  permissionsRequest: "desktop:v1:permissions-request",
  realtimeClose: "desktop:v1:realtime-close",
  realtimeConnect: "desktop:v1:realtime-connect",
  realtimeEvent: "desktop:v1:realtime-event",
  realtimeSend: "desktop:v1:realtime-send",
  realtimeSnapshot: "desktop:v1:realtime-snapshot",
  realtimeUnauthorized: "desktop:v1:realtime-unauthorized",
  screenshotCancel: "desktop:v1:screenshot-cancel",
  screenshotCompleted: "desktop:v1:screenshot-completed",
  screenshotStartFailed: "desktop:v1:screenshot-start-failed",
  screenshotMetadata: "desktop:v1:screenshot-metadata",
  screenshotResultChunk: "desktop:v1:screenshot-result-chunk",
  screenshotResultFinish: "desktop:v1:screenshot-result-finish",
  screenshotResultStart: "desktop:v1:screenshot-result-start",
  screenshotStart: "desktop:v1:screenshot-start",
  searchOpen: "desktop:v1:search-open",
  shortcutRecordingBegin: "desktop:v1:shortcut-recording-begin",
  shortcutRecordingCancel: "desktop:v1:shortcut-recording-cancel",
  shortcutScreenshotSet: "desktop:v1:shortcut-screenshot-set",
  shortcutSearchSet: "desktop:v1:shortcut-search-set",
  shortcutSendMessageSet: "desktop:v1:shortcut-send-message-set",
  shortcutsGetState: "desktop:v1:shortcuts-get-state",
  serversAdd: "desktop:v1:servers-add",
  serversList: "desktop:v1:servers-list",
  serversRemove: "desktop:v1:servers-remove",
  serversRename: "desktop:v1:servers-rename",
  serversSelect: "desktop:v1:servers-select",
  settingsGet: "desktop:v1:settings-get",
  settingsSet: "desktop:v1:settings-set",
  storageCacheClear: "desktop:v1:storage-cache-clear",
  storageGetStats: "desktop:v1:storage-get-stats",
  transportCancel: "desktop:v1:transport-cancel",
  transportStreamAbort: "desktop:v1:transport-stream-abort",
  transportStreamChunk: "desktop:v1:transport-stream-chunk",
  transportStreamFinish: "desktop:v1:transport-stream-finish",
  transportStreamStart: "desktop:v1:transport-stream-start",
  transportRequest: "desktop:v1:transport-request",
  updaterCheck: "desktop:v1:updater-check",
  updaterCancel: "desktop:v1:updater-cancel",
  updaterDownload: "desktop:v1:updater-download",
  updaterGetState: "desktop:v1:updater-get-state",
  updaterInstall: "desktop:v1:updater-install",
  updaterOpenManual: "desktop:v1:updater-open-manual",
  updaterOpenRelease: "desktop:v1:updater-open-release",
  updaterState: "desktop:v1:updater-state",
  unknownServer: "desktop:v1:unknown-server",
} as const

export type DesktopThemeSource = "dark" | "light" | "system"

export type DesktopLanguage = "zh-CN" | "en"

export type DesktopFontScale = "normal" | "medium" | "large"

export type ServerProfile = ServerTarget &
  Readonly<{
    createdAt: string
    displayName: string
    lastUserId?: string
  }>

export type DesktopSettings = Readonly<{
  autoLaunch: boolean
  closeBehavior: "background" | "quit"
  fontScale: DesktopFontScale
  language: DesktopLanguage
  messageNotificationsEnabled: boolean
  messageSoundEnabled: boolean
  notificationPrivacy: "hidden" | "metadata" | "preview"
  screenshotShortcut: string | null
  searchShortcut: string | null
  sendMessageShortcut: string | null
  selectedServerId?: string
}>

export type DesktopSettingsPatch = Partial<
  Omit<
    DesktopSettings,
    "screenshotShortcut" | "searchShortcut" | "sendMessageShortcut" | "selectedServerId"
  >
>

export type DesktopAppInfo = Readonly<{
  arch: string
  build: string
  channel: "preview" | "stable" | "test"
  packaged: boolean
  platform: string
  version: string
}>

export type DesktopAuthResult = Readonly<{
  error?: string
  status: "canceled" | "error" | "success"
  transactionId: string
  userId?: string
}>

export type RendererRuntimeSnapshot = Readonly<{
  activeRefreshes: number
  activeRequests: number
  appActivatedAgeMs?: number
  data: Readonly<{
    contacts: number
    conversations: number
    loadedConversations: number
    messages: number
    projects: number
  }>
  eventLoopLagMs: number
  documentVisibility?: "hidden" | "visible"
  lastRefresh?: Readonly<{
    ageMs: number
    durationMs: number
    name: "contacts" | "conversations" | "me" | "projects"
  }>
  lastRequest?: Readonly<{
    ageMs: number
    durationMs: number
    group: string
    method: string
    status?: number
  }>
  longTasks: Readonly<{ count: number; maxDurationMs: number }>
  navigatorOnline?: boolean
  page: "chat" | "contacts" | "init" | "login" | "projects" | "setup" | "unknown"
  windowFocused?: boolean
  windowMinimized?: boolean
  windowVisible?: boolean
}>

export type UpdaterStatus =
  | "available"
  | "checking"
  | "downloaded"
  | "downloading"
  | "error"
  | "idle"
  | "installing"
  | "manual"
  | "unsupported"

export type UpdaterErrorCode =
  | "checksum_invalid"
  | "disk_full"
  | "metadata_invalid"
  | "network"
  | "permission_denied"
  | "platform_mismatch"
  | "platform_signature_required"
  | "rate_limited"
  | "update_failed"

export type UpdaterState = Readonly<{
  currentBuild: number
  currentVersion: string
  errorCode?: UpdaterErrorCode
  installMode: "manual" | "ota" | "unsupported"
  installationSource: "appimage" | "deb" | "development" | "mac_app" | "nsis" | "unknown"
  manualAction?: Readonly<{ label: string }>
  progress?: number
  retryable: boolean
  status: UpdaterStatus
  targetBuild?: number
  targetVersion?: string
}>

export type UpdaterInstallResult = Readonly<{
  reason?:
    | "active_transfers"
    | "install_failed"
    | "install_in_progress"
    | "not_downloaded"
    | "prepare_failed"
  status: "blocked" | "failed" | "started"
}>

export interface DesktopBridge {
  readonly version: typeof BRIDGE_VERSION
  app: { info(): Promise<DesktopAppInfo> }
  asr: ASRBridge
  appearance: { setThemeSource(source: DesktopThemeSource): Promise<void> }
  badge: { set(count: number): Promise<void> }
  tray: { setMessages(messages: ReadonlyArray<TrayMessage>): Promise<void> }
  clipboard: {
    writePng(bytes: Uint8Array): Promise<void>
    writeText(value: string): Promise<void>
  }
  auth: {
    cancel(transactionId: string): Promise<void>
    subscribeFinished(listener: (result: DesktopAuthResult) => void): () => void
    start(serverId: string, providerKey: string): Promise<{ transactionId: string }>
  }
  diagnostics: {
    clearStorage(): Promise<DiagnosticStorageStats>
    export(): Promise<{ path?: string }>
    getStorageStats(): Promise<DiagnosticStorageStats>
    record(event: DiagnosticEventInput): Promise<DiagnosticEvent | undefined>
    reportRuntime(snapshot: RendererRuntimeSnapshot): void
  }
  documentCollaboration: DocumentCollaborationBridge
  files: {
    download(
      target: AuthenticatedTarget,
      path: string,
      suggestedName: string,
    ): Promise<{ path?: string }>
    openLocation(path: string): Promise<void>
    pick(options?: {
      multiple?: boolean
    }): Promise<ReadonlyArray<{ id: string; name: string; size: number }>>
    upload(target: AuthenticatedTarget, apiPath: string, fileId: string): Promise<ClientResponse>
  }
  messageCache: MessageCacheBridge
  notifications: { show(input: NotificationInput): Promise<void> }
  navigation: {
    openDocumentWindow(
      documentId: string,
      serverId: string,
      documentType: DocumentWindowDocumentType,
    ): Promise<DocumentWindowOpenResponse>
    subscribe(listener: (route: string) => void): () => void
    subscribeUnknownServer(listener: (input: { serverId: string }) => void): () => void
  }
  permissions: {
    openSettings(kind: "screen"): Promise<boolean>
    request(kind: "microphone" | "notifications"): Promise<boolean>
  }
  realtime: {
    close(target: AuthenticatedTarget): Promise<void>
    connect(target: AuthenticatedTarget): Promise<RealtimeSnapshot>
    send(target: AuthenticatedTarget, method: string, payload: unknown): Promise<unknown>
    subscribe(listener: (envelope: RealtimeEnvelope) => void): () => void
    subscribeSnapshot(listener: (snapshot: RealtimeSnapshot) => void): () => void
    subscribeUnauthorized(listener: (target: AuthenticatedTarget) => void): () => void
  }
  screenshot: ScreenshotBridge
  shortcuts: ShortcutBridge
  servers: {
    add(url: string, displayName?: string): Promise<ServerProfile>
    list(): Promise<ReadonlyArray<ServerProfile>>
    remove(id: string): Promise<boolean>
    rename(id: string, displayName: string): Promise<ServerProfile>
    select(id: string): Promise<void>
  }
  settings: {
    get(): Promise<DesktopSettings>
    set(patch: DesktopSettingsPatch): Promise<DesktopSettings>
  }
  storage: {
    clearCache(kinds: ReadonlyArray<StorageCacheKind>): Promise<StorageClearResult>
    getStats(): Promise<DesktopStorageStats>
  }
  shell: { openExternal(url: string): Promise<void> }
  transport: {
    cancel(requestId: string): Promise<void>
    request<T>(target: AuthenticatedTarget, request: ClientRequest): Promise<ClientResponse<T>>
    streamAbort(streamId: string): Promise<void>
    streamChunk(streamId: string, chunk: Uint8Array): Promise<void>
    streamFinish<T>(streamId: string): Promise<ClientResponse<T>>
    streamStart(
      target: AuthenticatedTarget,
      request: Pick<ClientRequest, "headers" | "method" | "path" | "requestId">,
    ): Promise<string>
  }
  updater: {
    cancelDownload(): Promise<UpdaterState>
    check(): Promise<UpdaterState>
    download(): Promise<void>
    getState(): Promise<UpdaterState>
    install(): Promise<UpdaterInstallResult>
    openManualDownload(): Promise<void>
    openReleasePage(): Promise<void>
    subscribe(listener: (state: UpdaterState) => void): () => void
  }
}

export type NotificationInput = Readonly<{
  conversationId: string
  messageId: string
  muted?: boolean
  preview?: string
  sender?: string
  target: AuthenticatedTarget
  workspace?: string
}>

export type TrayMessage = Readonly<{
  conversationId: string
  name: string
  serverId: string
  summary: string
  unreadCount: number
}>
