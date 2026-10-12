import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import type { UpdateInfo, UpdateProgress } from "../shared/desktop"
import {
  readDismissedUpdate,
  saveDismissedUpdate,
  shouldPromptForUpdate,
  updateVersionKey,
} from "./update-prompt"

type UpdateContextValue = {
  checking: boolean
  checkUpdates: (manual: boolean) => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function useUpdateDialog(): UpdateContextValue {
  const value = useContext(UpdateContext)
  if (!value) throw new Error("更新对话框尚未初始化")
  return value
}

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useAnimatedToast()
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [error, setError] = useState("")
  const checkingRef = useRef(false)
  const manualRef = useRef(false)
  const startupChecked = useRef(false)
  const updateKey = useRef("")
  const dismissedUpdateKey = useRef(readDismissedUpdate())

  const checkUpdates = useCallback(
    (manual: boolean) => {
      if (manual) manualRef.current = true
      if (!window.desktop) {
        if (manual) showToast({ status: "error", title: "请在桌面客户端中检查更新" })
        manualRef.current = false
        return
      }
      if (checkingRef.current) return
      checkingRef.current = true
      setChecking(true)
      void window.desktop
        .checkForUpdates()
        .then((result) => {
          if (!result.ok) throw new Error(result.error.message)
          if (!result.data.updateAvailable) {
            if (manualRef.current) showToast({ status: "success", title: "当前已是最新版本" })
            return
          }
          if (!shouldPromptForUpdate(result.data, manualRef.current, dismissedUpdateKey.current)) {
            return
          }
          const nextKey = `${result.data.platform}:${result.data.latestBuildId}:${result.data.downloadUrl}:${result.data.updateFeed ?? ""}`
          if (updateKey.current !== nextKey) {
            updateKey.current = nextKey
            setDownloaded(false)
            setProgress(null)
            setError("")
          }
          setUpdate(result.data)
          setOpen(true)
        })
        .catch((reason: unknown) => {
          if (manualRef.current) {
            showToast({
              status: "error",
              title: "检查更新失败",
              description: reason instanceof Error ? reason.message : undefined,
            })
          }
        })
        .finally(() => {
          checkingRef.current = false
          manualRef.current = false
          setChecking(false)
        })
    },
    [showToast],
  )

  useEffect(() => {
    if (!startupChecked.current) {
      startupChecked.current = true
      checkUpdates(false)
    }
    const timer = window.setInterval(() => checkUpdates(false), 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [checkUpdates])

  useEffect(() => window.desktop?.onUpdateProgress(setProgress), [])

  async function download() {
    if (!window.desktop || downloading) return
    setDownloading(true)
    setError("")
    try {
      const result = await window.desktop.downloadUpdate()
      if (!result.ok) throw new Error(result.error.message)
      setDownloaded(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新安装包下载失败")
    } finally {
      setDownloading(false)
    }
  }

  async function install() {
    if (!window.desktop || installing) return
    setInstalling(true)
    setError("")
    try {
      const result = await window.desktop.installUpdate()
      if (!result.ok) throw new Error(result.error.message)
      setOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法打开更新安装包")
    } finally {
      setInstalling(false)
    }
  }

  async function restartToInstall() {
    if (!window.desktop || installing) return
    setInstalling(true)
    setError("")
    try {
      const result = await window.desktop.restartToInstallUpdate()
      if (!result.ok) throw new Error(result.error.message)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法启动自动更新")
    } finally {
      setInstalling(false)
    }
  }

  function dismissUpdate() {
    if (update) {
      dismissedUpdateKey.current = updateVersionKey(update)
      saveDismissedUpdate(update)
    }
    setOpen(false)
  }

  const isLinux = update?.platform === "linux-amd" || update?.platform === "linux-arm"
  const isMacAutomatic = update?.platform === "macos" && Boolean(update.updateFeed)
  const installLabel = isLinux
    ? "打开下载位置"
    : update?.platform === "windows"
      ? "安装更新包"
      : "立即更新"
  const instructions = isLinux
    ? "退出当前应用后，用下载的 AppImage 替换原文件，再启动新版。"
    : isMacAutomatic
      ? downloaded
        ? "更新已准备好；退出客户端时将自动安装，也可以现在重启更新。"
        : "将下载自动更新包；下载完成后仍可继续使用，正常退出时再安装。"
      : update?.platform === "macos"
        ? "打开安装镜像后，请退出当前应用，将新版拖入“应用程序”并选择替换。"
        : "将打开 Windows 安装程序，客户端不会自动退出；安装时可能需要先关闭客户端。"

  return (
    <UpdateContext.Provider value={{ checking, checkUpdates }}>
      {children}
      <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? setOpen(true) : dismissUpdate())}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>发现新版本</DialogTitle>
            <DialogDescription>
              {update && `即应 ${update.latestVersion}（Build ${update.latestBuildId}）可用。`}
            </DialogDescription>
          </DialogHeader>
          {downloading && (
            <div className="space-y-2" role="status" aria-live="polite">
              {progress?.percent === null || !progress ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              ) : (
                <Progress value={progress.percent} />
              )}
              <p className="text-sm text-muted-foreground">
                {progress?.percent === null
                  ? `正在下载更新：${(progress.received / 1_048_576).toFixed(1)} MB`
                  : `正在下载更新：${progress?.percent ?? 0}%`}
              </p>
            </div>
          )}
          {downloaded && <p className="text-sm text-muted-foreground">{instructions}</p>}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={isMacAutomatic && downloaded ? () => setOpen(false) : dismissUpdate}
              disabled={installing}
            >
              {isMacAutomatic && downloaded ? "稍后退出时安装" : "以后再说"}
            </Button>
            {downloaded ? (
              <Button
                onClick={() => void (isMacAutomatic ? restartToInstall() : install())}
                disabled={installing}
              >
                {installing ? "正在打开" : isMacAutomatic ? "现在重启更新" : installLabel}
              </Button>
            ) : (
              <Button onClick={() => void download()} disabled={downloading || !update}>
                {downloading ? "正在下载" : error ? "重试下载" : "立即更新"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </UpdateContext.Provider>
  )
}
