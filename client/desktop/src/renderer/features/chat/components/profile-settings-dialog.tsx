import { useEffect, useId, useState, type FormEvent } from "react"
import { Camera, Loader2, X } from "lucide-react"
import type { AuthUser } from "../../../../shared/auth"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GroupAvatarPicker } from "./group-avatar-picker"

const builtinAvatars = Array.from(
  { length: 64 },
  (_, index) => `/assets/avatars/builtin/${String(index + 1).padStart(2, "0")}.webp`,
)

export function ProfileSettingsDialog({
  open,
  onOpenChange,
  targetId,
  serverUrl,
  userId,
  userName,
  userEmail,
  theme,
  onUserUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetId: string
  serverUrl: string
  userId: string
  userName: string
  userEmail: string
  theme: "light" | "dark"
  onUserUpdated: (user: AuthUser) => void
}) {
  const { showToast } = useAnimatedToast()
  const nicknameId = useId()
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [nickname, setNickname] = useState("")
  const [loading, setLoading] = useState(false)
  const [nicknameSaving, setNicknameSaving] = useState(false)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const displayName = profile?.nickname?.trim() || profile?.name || userName
  const nicknameChanged = nickname.trim() !== (profile?.nickname ?? "")

  useEffect(() => {
    if (!open || !window.desktop) return
    let cancelled = false
    setLoading(true)
    setProfile(null)
    setNickname("")
    void window.desktop.accountData
      .getProfile(targetId)
      .then((result) => {
        if (cancelled) return
        if (!result.ok) throw new Error(result.error.message)
        setProfile(result.data)
        setNickname(result.data.nickname ?? "")
        onUserUpdated(result.data)
      })
      .catch((reason) => {
        if (!cancelled) {
          showToast({ status: "error", title: "读取个人资料失败", description: String(reason) })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, targetId, onUserUpdated, showToast])

  function applyProfile(user: AuthUser) {
    setProfile(user)
    setNickname(user.nickname ?? "")
    onUserUpdated(user)
  }

  async function saveNickname() {
    if (loading || nicknameSaving || !nicknameChanged || !window.desktop) return
    setNicknameSaving(true)
    try {
      const result = await window.desktop.accountData.updateProfile({
        targetId,
        nickname: nickname.trim(),
      })
      if (!result.ok) throw new Error(result.error.message)
      applyProfile(result.data)
      showToast({ status: "success", title: "昵称已保存" })
    } catch (reason) {
      showToast({
        status: "error",
        title: "保存昵称失败",
        description: reason instanceof Error ? reason.message : undefined,
      })
    } finally {
      setNicknameSaving(false)
    }
  }

  async function saveAvatar(avatar: string | ArrayBuffer) {
    if (avatarSaving || !window.desktop) return
    setAvatarSaving(true)
    try {
      const result =
        typeof avatar === "string"
          ? await window.desktop.accountData.updateProfile({ targetId, avatar })
          : await window.desktop.accountData.uploadProfileAvatar({ targetId, bytes: avatar })
      if (!result.ok) throw new Error(result.error.message)
      applyProfile(result.data)
      setAvatarPickerOpen(false)
      showToast({ status: "success", title: "头像已保存" })
    } catch (reason) {
      showToast({
        status: "error",
        title: "保存头像失败",
        description: reason instanceof Error ? reason.message : undefined,
      })
      throw reason
    } finally {
      setAvatarSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-md"
        >
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div>
              <DialogTitle>个人资料</DialogTitle>
              <DialogDescription className="sr-only">
                查看个人资料并编辑昵称和头像
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭个人资料">
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <ScrollArea
            type="hover"
            className="-mx-2 min-h-0"
            viewportClassName="h-auto! max-h-[calc(80vh-10rem)] overflow-x-hidden"
          >
            <div className="grid gap-5 px-2 py-1">
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  aria-label="更换头像"
                  aria-haspopup="dialog"
                  disabled={loading || !profile}
                  className="group relative shrink-0 overflow-hidden rounded-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                  onClick={() => setAvatarPickerOpen(true)}
                >
                  <EntityAvatar
                    targetId={targetId}
                    type="user"
                    id={userId}
                    theme={theme}
                    size={68}
                    label={displayName}
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    <Camera className="size-5" />
                  </span>
                </button>
                <div className="grid min-w-0 flex-1 gap-2">
                  <label htmlFor={nicknameId} className="text-sm font-medium">
                    昵称
                  </label>
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event: FormEvent<HTMLFormElement>) => {
                      event.preventDefault()
                      void saveNickname()
                    }}
                  >
                    <Input
                      id={nicknameId}
                      className="min-w-0 flex-1"
                      value={nickname}
                      maxLength={256}
                      disabled={loading || nicknameSaving}
                      placeholder="输入昵称"
                      onChange={(event) => setNickname(event.target.value)}
                    />
                    {nicknameChanged && (
                      <Button type="submit" disabled={loading || nicknameSaving}>
                        {nicknameSaving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                        提交
                      </Button>
                    )}
                  </form>
                </div>
              </div>
              <div className="grid gap-4">
                <ReadonlyField label="姓名" value={profile?.name || userName} />
                <ReadonlyField label="邮箱" value={profile?.email || userEmail} />
                <ReadonlyField label="手机号" value={profile?.phone || ""} placeholder="未设置" />
              </div>
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0 flex-row justify-end">
            <DialogClose asChild>
              <Button type="button">关闭</Button>
            </DialogClose>
          </DialogFooter>
          <ProfileAvatarPicker
            open={avatarPickerOpen}
            onOpenChange={setAvatarPickerOpen}
            serverUrl={serverUrl}
            currentAvatar={profile?.avatar || ""}
            saving={avatarSaving}
            onSave={saveAvatar}
          />
        </DialogContent>
      )}
    </Dialog>
  )
}

function ReadonlyField({
  label,
  value,
  placeholder,
}: {
  label: string
  value: string
  placeholder?: string
}) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        readOnly
        placeholder={placeholder}
        className="border-muted-foreground/20 bg-muted/50"
      />
    </div>
  )
}

function ProfileAvatarPicker({
  open,
  onOpenChange,
  serverUrl,
  currentAvatar,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverUrl: string
  currentAvatar: string
  saving: boolean
  onSave: (avatar: string | ArrayBuffer) => Promise<void>
}) {
  const formId = useId()
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState<"builtin" | "custom">("builtin")
  const [selected, setSelected] = useState(currentAvatar)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setSelected(currentAvatar)
      setMode(builtinAvatars.includes(currentAvatar) ? "builtin" : "custom")
      setError("")
      setReady(false)
    }
  }, [open, currentAvatar])

  async function saveBuiltin() {
    if (saving || !builtinAvatars.includes(selected)) return
    setError("")
    try {
      await onSave(selected)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存头像")
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
    >
      {open && (
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[calc(100dvh-var(--desktop-titlebar-height)-1rem)] min-w-0 flex-col gap-4 overflow-x-hidden overflow-y-auto p-5 sm:max-w-[28rem]"
        >
          <div className="flex shrink-0 items-start justify-between gap-4">
            <div>
              <DialogTitle>选择头像</DialogTitle>
              <DialogDescription className="sr-only">
                选择系统头像或上传自定义头像
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="关闭头像选择"
                disabled={saving}
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as "builtin" | "custom")
              setError("")
            }}
            className="shrink-0"
          >
            <TabsList className="shrink-0">
              <TabsTrigger value="builtin" disabled={saving}>
                系统头像
              </TabsTrigger>
              <TabsTrigger value="custom" disabled={saving}>
                自定义头像
              </TabsTrigger>
            </TabsList>
            <TabsContent value="builtin" className="min-h-0">
              <ScrollArea
                type="hover"
                className="-mr-2 min-h-0"
                viewportClassName="h-auto! max-h-[calc(100dvh-var(--desktop-titlebar-height)-12rem)] overflow-x-hidden"
              >
                <div className="grid grid-cols-4 gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-8">
                  {builtinAvatars.map((avatar, index) => (
                    <button
                      key={avatar}
                      type="button"
                      aria-label={`选择头像 ${String(index + 1).padStart(2, "0")}`}
                      aria-pressed={selected === avatar}
                      disabled={saving}
                      className="flex size-9 items-center justify-center rounded-sm bg-background p-0.5 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-pressed:ring-2 aria-pressed:ring-ring disabled:opacity-50"
                      onClick={() => setSelected(avatar)}
                    >
                      <img
                        alt=""
                        loading="lazy"
                        src={new URL(avatar, serverUrl).toString()}
                        className="size-8 rounded-sm object-cover"
                      />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="custom" className="min-h-0">
              <GroupAvatarPicker
                formId={formId}
                saving={saving}
                onReadyChange={setReady}
                onSave={async (bytes) => onSave(bytes)}
              />
            </TabsContent>
          </Tabs>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="shrink-0 flex-row justify-end">
            <Button
              type={mode === "custom" ? "submit" : "button"}
              form={mode === "custom" ? formId : undefined}
              disabled={saving || (mode === "custom" ? !ready : !builtinAvatars.includes(selected))}
              onClick={mode === "builtin" ? () => void saveBuiltin() : undefined}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
