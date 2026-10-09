import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  checkNotificationPermission,
  getNotificationPermission,
  type NotificationPermissionState,
} from "@/lib/notification-permission"

type PermissionCheckOptions = {
  request?: boolean
  remindOnce?: boolean
}

type NotificationPermissionContextValue = {
  ensureNotificationPermission(options?: PermissionCheckOptions): Promise<boolean>
}

const NotificationPermissionContext = createContext<NotificationPermissionContextValue | null>(null)

function notificationApi() {
  return typeof Notification === "undefined" ? undefined : Notification
}

export function NotificationPermissionProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(notificationApi()),
  )
  const reminded = useRef(false)

  const ensureNotificationPermission = useCallback(
    async ({ request = false, remindOnce = false }: PermissionCheckOptions = {}) => {
      const next = await checkNotificationPermission(notificationApi(), request)
      setPermission(next)
      if (next === "granted" || next === "unsupported") {
        setOpen(false)
        return true
      }
      if (!remindOnce || !reminded.current) {
        reminded.current = true
        setOpen(true)
      }
      return false
    },
    [],
  )

  useEffect(() => {
    const handleFocus = () => {
      if (!open) return
      const next = getNotificationPermission(notificationApi())
      setPermission(next)
      if (next === "granted") setOpen(false)
    }
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [open])

  const value = useMemo(() => ({ ensureNotificationPermission }), [ensureNotificationPermission])

  async function handlePrimaryAction() {
    if (permission === "default") {
      await ensureNotificationPermission({ request: true })
      return
    }
    await window.desktop?.openNotificationSettings()
  }

  return (
    <NotificationPermissionContext.Provider value={value}>
      {children}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>开启系统通知</AlertDialogTitle>
            <AlertDialogDescription>
              即应已启用桌面通知，但系统通知权限尚未开启。开启后，新消息才能显示系统通知。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>稍后</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handlePrimaryAction()
              }}
            >
              {permission === "default" ? "允许通知" : "打开系统设置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </NotificationPermissionContext.Provider>
  )
}

export function useNotificationPermission() {
  const context = useContext(NotificationPermissionContext)
  if (!context) throw new Error("通知权限组件尚未初始化")
  return context
}
