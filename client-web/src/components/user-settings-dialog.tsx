import { useState } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "@/lib/browser-notifications"
import {
  isBrowserMessageNotificationEnabled,
  isMessageNotificationSoundEnabled,
  setBrowserMessageNotificationEnabled,
  setMessageNotificationSoundEnabled,
} from "@/lib/message-notification-preferences"
import { playMessageNotificationSound } from "@/lib/message-notification-sound"

type UserSettingsDialogProps = {
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function UserSettingsDialog({
  onOpenChange,
  open,
}: UserSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <UserSettingsDialogContent />}
    </Dialog>
  )
}

function UserSettingsDialogContent() {
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(() =>
      getBrowserNotificationPermission()
    )
  const [notificationRequesting, setNotificationRequesting] = useState(false)
  const [browserNotificationEnabled, setBrowserNotificationEnabledState] =
    useState(isBrowserMessageNotificationEnabled)
  const [notificationSoundEnabled, setNotificationSoundEnabledState] = useState(
    isMessageNotificationSoundEnabled
  )

  function handleNotificationSoundEnabledChange(enabled: boolean) {
    setNotificationSoundEnabledState(enabled)
    setMessageNotificationSoundEnabled(enabled)
  }

  async function handleBrowserNotificationEnabledChange(enabled: boolean) {
    if (notificationRequesting) {
      return
    }

    if (!enabled) {
      setBrowserNotificationEnabledState(false)
      setBrowserMessageNotificationEnabled(false)
      return
    }

    if (notificationPermission === "granted") {
      setBrowserNotificationEnabledState(true)
      setBrowserMessageNotificationEnabled(true)
      return
    }
    if (notificationPermission !== "default") {
      return
    }

    playMessageNotificationSound()
    setNotificationRequesting(true)
    try {
      const permission = await requestBrowserNotificationPermission()
      setNotificationPermission(permission)
      if (permission === "granted") {
        setBrowserNotificationEnabledState(true)
        setBrowserMessageNotificationEnabled(true)
      }
    } finally {
      setNotificationRequesting(false)
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="flex w-[calc(100vw-2rem)] max-w-md flex-col gap-5 rounded-md border bg-background p-5 text-foreground shadow-lg ring-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle className="text-base font-medium">设置</DialogTitle>
          <DialogDescription className="sr-only">
            管理个人设置
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <Button
            aria-label="关闭设置"
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">桌面通知</div>
          <div className="text-xs text-muted-foreground">
            {getNotificationPermissionText(
              notificationPermission,
              browserNotificationEnabled
            )}
          </div>
        </div>
        <Switch
          aria-label="桌面通知"
          checked={
            notificationPermission === "granted" && browserNotificationEnabled
          }
          disabled={
            notificationRequesting ||
            notificationPermission === "denied" ||
            notificationPermission === "unsupported"
          }
          onCheckedChange={(enabled) =>
            void handleBrowserNotificationEnabledChange(enabled)
          }
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
        <div className="min-w-0">
          <label
            className="text-sm font-medium"
            htmlFor="message-notification-sound"
          >
            消息通知铃声
          </label>
          <div className="text-xs text-muted-foreground">
            收到新消息时播放提示音
          </div>
        </div>
        <Switch
          checked={notificationSoundEnabled}
          id="message-notification-sound"
          onCheckedChange={handleNotificationSoundEnabledChange}
        />
      </div>

      <div className="flex justify-end">
        <DialogClose asChild>
          <Button type="button">关闭</Button>
        </DialogClose>
      </div>
    </DialogContent>
  )
}

function getNotificationPermissionText(
  permission: BrowserNotificationPermission,
  enabled: boolean
) {
  switch (permission) {
    case "granted":
      return enabled ? "桌面通知已开启" : "桌面通知已关闭"
    case "denied":
      return "通知权限已被浏览器阻止"
    case "unsupported":
      return "当前浏览器不支持桌面通知"
    default:
      return "尚未开启"
  }
}
