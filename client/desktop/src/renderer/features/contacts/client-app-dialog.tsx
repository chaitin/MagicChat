import { useEffect, useId, useRef, useState } from "react"
import { Blocks, BookOpen, Camera, Copy, RotateCcw } from "lucide-react"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
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
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { MAGICCHAT_APP_DEVELOPMENT } from "../../../shared/desktop"
import type {
  ClientAppVisibility,
  DesktopClientApp,
  DesktopClientAppCredentials,
  DesktopContactUser,
  SelectedClientAppAvatar,
} from "../../../shared/account-data"

export function ClientAppDialog({
  mode,
  targetId,
  serverUrl,
  currentUserId,
  theme,
  users,
  credentials,
  onClose,
  onChanged,
  onAvatarChanged,
}: {
  mode: "create" | "edit" | "credentials"
  targetId: string
  serverUrl: string
  currentUserId: string
  theme: "light" | "dark"
  users: DesktopContactUser[]
  credentials: DesktopClientAppCredentials | null
  onClose: () => void
  onChanged: () => void
  onAvatarChanged: () => void
}) {
  const { showToast } = useAnimatedToast()
  const nameId = useId()
  const descriptionId = useId()
  const visibilityId = useId()
  const pendingAvatarRef = useRef<SelectedClientAppAvatar | null>(null)
  const [pendingAvatar, setPendingAvatar] = useState<SelectedClientAppAvatar | null>(null)
  const [selectingAvatar, setSelectingAvatar] = useState(false)
  const [name, setName] = useState(credentials?.app.name ?? "")
  const [description, setDescription] = useState(credentials?.app.description ?? "")
  const [visibility, setVisibility] = useState<ClientAppVisibility>(
    credentials?.app.visibility ?? "creator",
  )
  const [userIds, setUserIds] = useState<string[]>(credentials?.app.userIds ?? [])
  const [secret, setSecret] = useState(credentials?.connectionSecret ?? "")
  const [createdCredentials, setCreatedCredentials] = useState<DesktopClientAppCredentials | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const accessCredentials = createdCredentials ?? credentials
  const grantableUsers = users.filter(
    (user) => user.id.toLowerCase() !== currentUserId.toLowerCase(),
  )

  useEffect(() => {
    return () => {
      if (pendingAvatarRef.current) {
        void window.desktop?.accountData.releaseMessageFile({
          targetId,
          token: pendingAvatarRef.current.token,
        })
      }
    }
  }, [targetId])

  async function selectAvatar() {
    if (busy || selectingAvatar) return
    setSelectingAvatar(true)
    try {
      const result = await window.desktop!.accountData.selectClientAppAvatar(targetId)
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) return
      const previous = pendingAvatarRef.current
      pendingAvatarRef.current = result.data
      setPendingAvatar(result.data)
      if (previous) {
        void window.desktop!.accountData.releaseMessageFile({ targetId, token: previous.token })
      }
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "处理应用头像失败",
        status: "error",
      })
    } finally {
      setSelectingAvatar(false)
    }
  }

  async function resetSecret(appId: string) {
    if (resetting) return
    setResetting(true)
    try {
      const result = await window.desktop!.accountData.regenerateClientAppSecret({
        targetId,
        id: appId,
      })
      if (!result.ok) {
        showToast({ title: result.error.message, status: "error" })
        return
      }
      setSecret(result.data.connectionSecret)
      setResetOpen(false)
      showToast({ title: "连接密钥已重置", status: "success" })
    } catch {
      showToast({ title: "重置连接密钥失败", status: "error" })
    } finally {
      setResetting(false)
    }
  }

  async function openDevelopmentDocs() {
    try {
      const result = await window.desktop!.openExternalLink(MAGICCHAT_APP_DEVELOPMENT)
      if (!result.ok) showToast({ title: result.error.message, status: "error" })
    } catch {
      showToast({ title: "无法打开开发文档", status: "error" })
    }
  }
  if ((mode === "credentials" || createdCredentials) && accessCredentials) {
    const server = serverUrl ? new URL(serverUrl) : null
    const webSocketURL = server
      ? `${server.protocol === "https:" ? "wss:" : "ws:"}//${server.host}/api/app/ws`
      : ""
    return (
      <>
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !resetOpen && !resetting) onClose()
          }}
        >
          <DialogContent
            className="max-h-[80vh] overflow-y-auto sm:max-w-lg"
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>开发指南</DialogTitle>
              <DialogDescription className="sr-only">查看应用连接信息和开发文档</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <CredentialField label="应用 ID" value={accessCredentials.app.id} />
              <CredentialField label="WebSocket 地址" value={webSocketURL} />
              <CredentialField label="连接密钥" value={secret} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={resetting} onClick={() => setResetOpen(true)}>
                  <RotateCcw aria-hidden />
                  重置连接密钥
                </Button>
                <Button variant="secondary" onClick={() => void openDevelopmentDocs()}>
                  <BookOpen aria-hidden />
                  开发文档
                </Button>
              </div>
              <Button disabled={resetting} onClick={onClose}>
                关闭
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={resetOpen}
          onOpenChange={(open) => {
            if (!resetting) setResetOpen(open)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>重置连接密钥</AlertDialogTitle>
              <AlertDialogDescription>
                重置后旧密钥立即失效，应用现有的 WebSocket 连接也会被断开。确定继续吗？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={resetting}
                onClick={(event) => {
                  event.preventDefault()
                  void resetSecret(accessCredentials.app.id)
                }}
              >
                {resetting ? "重置中…" : "确认重置"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }
  if (mode === "edit" && credentials) {
    return (
      <EditAppProfileDialog
        credentials={credentials}
        currentUserId={currentUserId}
        onChanged={onChanged}
        onAvatarChanged={onAvatarChanged}
        onClose={onClose}
        targetId={targetId}
        theme={theme}
        users={users}
      />
    )
  }

  async function save() {
    if (!canCreate) return
    setBusy(true)
    try {
      const result = await window.desktop!.accountData.createClientApp({
        targetId,
        name: name.trim(),
        description: description.trim(),
        visibility,
        userIds: visibility === "restricted" ? userIds : [],
      })
      if (!result.ok) throw new Error(result.error.message)
      let nextCredentials = result.data
      let avatarError: string | null = null
      if (pendingAvatar) {
        try {
          const uploaded = await window.desktop!.accountData.uploadClientAppAvatar({
            targetId,
            appId: result.data.app.id,
            selectionToken: pendingAvatar.token,
          })
          if (!uploaded.ok) throw new Error(uploaded.error.message)
          nextCredentials = { ...result.data, app: uploaded.data }
          const invalidated = await window
            .desktop!.accountData.invalidateAvatar({ targetId, type: "app", id: uploaded.data.id })
            .catch(() => null)
          if (!invalidated?.ok) {
            showToast({ title: "头像已保存，但本地预览刷新失败", status: "error" })
          }
          onAvatarChanged()
        } catch (error) {
          avatarError = error instanceof Error ? error.message : "头像上传失败"
          void window.desktop!.accountData.releaseMessageFile({
            targetId,
            token: pendingAvatar.token,
          })
        } finally {
          pendingAvatarRef.current = null
          setPendingAvatar(null)
        }
      }
      setCreatedCredentials(nextCredentials)
      setSecret(nextCredentials.connectionSecret)
      showToast({ title: "应用已创建", status: "success" })
      if (avatarError) {
        showToast({ title: `应用已创建，但头像上传失败：${avatarError}`, status: "error" })
      }
      onChanged()
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "创建应用失败",
        status: "error",
      })
    } finally {
      setBusy(false)
    }
  }
  const selectedUsers = grantableUsers.filter((user) =>
    userIds.some((id) => id.toLowerCase() === user.id.toLowerCase()),
  )
  const canCreate =
    !busy &&
    !selectingAvatar &&
    name.trim().length > 0 &&
    (visibility !== "restricted" || selectedUsers.length > 0)

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && !selectingAvatar && onClose()}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => (busy || selectingAvatar) && event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>创建应用</DialogTitle>
          <DialogDescription className="sr-only">
            填写应用头像、名称、描述和访问范围
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="flex items-center gap-4">
            <Button
              aria-label="上传应用头像"
              className="group/avatar-change relative h-auto shrink-0 overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
              disabled={busy || selectingAvatar}
              type="button"
              variant="ghost"
              onClick={() => void selectAvatar()}
            >
              {pendingAvatar ? (
                <img
                  className="size-17 rounded-sm object-cover"
                  src={pendingAvatar.resourceUrl}
                  alt={name.trim() || "应用头像预览"}
                />
              ) : (
                <span className="flex size-17 items-center justify-center rounded-sm bg-muted">
                  <Blocks className="size-5" aria-hidden />
                </span>
              )}
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/avatar-change:opacity-100 group-focus-visible/avatar-change:opacity-100">
                <Camera aria-hidden className="size-5" />
              </span>
            </Button>
            <div className="grid min-w-0 flex-1 gap-2">
              <Label htmlFor={nameId}>应用名称</Label>
              <Input
                autoFocus
                id={nameId}
                maxLength={120}
                required
                disabled={busy || selectingAvatar}
                placeholder="输入应用名称"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>应用描述</Label>
            <Textarea
              id={descriptionId}
              className="min-h-28 resize-none"
              maxLength={2000}
              disabled={busy || selectingAvatar}
              placeholder="简单介绍这个应用的用途"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <AppVisibilityRadioGroup
            disabled={busy || selectingAvatar}
            labelId={visibilityId}
            onValueChange={setVisibility}
            value={visibility}
          />

          {visibility === "restricted" && (
            <AppAccessUserPicker
              disabled={busy || selectingAvatar}
              grantableUsers={grantableUsers}
              onValueChange={(selected) => setUserIds(selected.map((user) => user.id))}
              selectedUsers={selectedUsers}
              targetId={targetId}
              theme={theme}
            />
          )}

          <DialogFooter>
            <Button
              disabled={busy || selectingAvatar}
              type="button"
              variant="outline"
              onClick={onClose}
            >
              取消
            </Button>
            <Button disabled={!canCreate} type="submit">
              {busy ? "创建中…" : "创建应用"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditAppProfileDialog({
  credentials,
  currentUserId,
  onChanged,
  onAvatarChanged,
  onClose,
  targetId,
  theme,
  users,
}: {
  credentials: DesktopClientAppCredentials
  currentUserId: string
  onChanged: () => void
  onAvatarChanged: () => void
  onClose: () => void
  targetId: string
  theme: "light" | "dark"
  users: DesktopContactUser[]
}) {
  const { showToast } = useAnimatedToast()
  const nameId = useId()
  const descriptionId = useId()
  const visibilityId = useId()
  const pendingAvatarRef = useRef<SelectedClientAppAvatar | null>(null)
  const [savedApp, setSavedApp] = useState<DesktopClientApp>(credentials.app)
  const [name, setName] = useState(credentials.app.name)
  const [description, setDescription] = useState(credentials.app.description)
  const [visibility, setVisibility] = useState<ClientAppVisibility>(credentials.app.visibility)
  const [userIds, setUserIds] = useState(credentials.app.userIds)
  const [pendingAvatar, setPendingAvatar] = useState<SelectedClientAppAvatar | null>(null)
  const [selectingAvatar, setSelectingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return () => {
      if (pendingAvatarRef.current) {
        void window.desktop?.accountData.releaseMessageFile({
          targetId,
          token: pendingAvatarRef.current.token,
        })
      }
    }
  }, [targetId])

  const grantableUsers = users.filter(
    (user) => user.id.toLowerCase() !== currentUserId.toLowerCase(),
  )
  const selectedUsers = userIds.map(
    (id) =>
      grantableUsers.find((user) => user.id.toLowerCase() === id.toLowerCase()) ?? {
        id,
        name: id,
        nickname: "",
        avatarType: "user" as const,
        avatarId: id,
        email: "",
        phone: "",
        online: false,
      },
  )
  const selectedAccessIds = visibility === "restricted" ? userIds : []
  const savedAccessIds = savedApp.visibility === "restricted" ? savedApp.userIds : []
  const profileChanged =
    name.trim() !== savedApp.name ||
    description.trim() !== savedApp.description ||
    visibility !== savedApp.visibility ||
    !sameIds(selectedAccessIds, savedAccessIds)
  const busy = selectingAvatar || saving
  const canSave =
    (profileChanged || pendingAvatar !== null) &&
    !busy &&
    name.trim().length > 0 &&
    (visibility !== "restricted" || userIds.length > 0)

  async function selectAvatar() {
    if (busy) return
    setSelectingAvatar(true)
    try {
      const result = await window.desktop!.accountData.selectClientAppAvatar(targetId)
      if (!result.ok) throw new Error(result.error.message)
      if (!result.data) return
      const previous = pendingAvatarRef.current
      pendingAvatarRef.current = result.data
      setPendingAvatar(result.data)
      if (previous) {
        void window.desktop!.accountData.releaseMessageFile({ targetId, token: previous.token })
      }
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "处理应用头像失败",
        status: "error",
      })
    } finally {
      setSelectingAvatar(false)
    }
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    try {
      if (profileChanged) {
        const result = await window.desktop!.accountData.updateClientApp({
          targetId,
          appId: savedApp.id,
          name: name.trim(),
          description: description.trim(),
          visibility,
          userIds: selectedAccessIds,
        })
        if (!result.ok) throw new Error(result.error.message)
        setSavedApp(result.data)
        setName(result.data.name)
        setDescription(result.data.description)
        setVisibility(result.data.visibility)
        setUserIds(result.data.userIds)
        onChanged()
      }
      if (pendingAvatar) {
        const result = await window.desktop!.accountData.uploadClientAppAvatar({
          targetId,
          appId: savedApp.id,
          selectionToken: pendingAvatar.token,
        })
        if (!result.ok) throw new Error(result.error.message)
        pendingAvatarRef.current = null
        setPendingAvatar(null)
        setSavedApp(result.data)
        const invalidated = await window
          .desktop!.accountData.invalidateAvatar({ targetId, type: "app", id: savedApp.id })
          .catch(() => null)
        if (!invalidated?.ok) {
          showToast({ title: "头像已保存，但本地预览刷新失败", status: "error" })
        }
        onAvatarChanged()
        onChanged()
      }
      showToast({ title: "应用资料已保存", status: "success" })
      onClose()
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : "保存应用资料失败",
        status: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>修改应用资料</DialogTitle>
          <DialogDescription className="sr-only">
            修改应用头像、名称、描述和访问范围
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <Button
            aria-label="更换应用头像"
            className="group/avatar-change relative h-auto shrink-0 overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
            disabled={busy}
            variant="ghost"
            onClick={() => void selectAvatar()}
          >
            {pendingAvatar ? (
              <img
                className="size-17 rounded-sm object-cover"
                src={pendingAvatar.resourceUrl}
                alt={name.trim() || savedApp.name}
              />
            ) : (
              <EntityAvatar
                targetId={targetId}
                type="app"
                id={savedApp.id}
                theme={theme}
                size={68}
                label={name.trim() || savedApp.name}
              />
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/avatar-change:opacity-100 group-focus-visible/avatar-change:opacity-100">
              <Camera aria-hidden className="size-5" />
            </span>
          </Button>
          <div className="grid min-w-0 flex-1 gap-2">
            <Label htmlFor={nameId}>应用名称</Label>
            <Input
              id={nameId}
              maxLength={120}
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor={descriptionId}>应用描述</Label>
            <Textarea
              id={descriptionId}
              className="min-h-28 resize-none"
              maxLength={2000}
              disabled={busy}
              placeholder="未填写应用描述"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <AppVisibilityRadioGroup
            disabled={busy}
            labelId={visibilityId}
            onValueChange={setVisibility}
            value={visibility}
          />
          {visibility === "restricted" && (
            <AppAccessUserPicker
              disabled={busy}
              grantableUsers={grantableUsers}
              onValueChange={(selected) => setUserIds(selected.map((user) => user.id))}
              selectedUsers={selectedUsers}
              targetId={targetId}
              theme={theme}
            />
          )}
        </div>

        <DialogFooter>
          <Button disabled={busy} variant="secondary" onClick={onClose}>
            关闭
          </Button>
          <Button disabled={!canSave} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AppVisibilityRadioGroup({
  disabled,
  labelId,
  onValueChange,
  value,
}: {
  disabled: boolean
  labelId: string
  onValueChange: (value: ClientAppVisibility) => void
  value: ClientAppVisibility
}) {
  return (
    <div className="grid gap-2">
      <Label id={labelId}>访问范围</Label>
      <RadioGroup
        aria-labelledby={labelId}
        className="grid gap-2 sm:grid-cols-3"
        disabled={disabled}
        value={value}
        onValueChange={(next) => onValueChange(next as ClientAppVisibility)}
      >
        {(
          [
            { value: "creator", label: "仅我自己" },
            { value: "public", label: "所有人" },
            { value: "restricted", label: "部分用户" },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            htmlFor={`${labelId}-${option.value}`}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 transition-colors hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
              value === option.value && "border-foreground/30 bg-muted",
            )}
          >
            <RadioGroupItem id={`${labelId}-${option.value}`} value={option.value} />
            <span className="leading-tight">{option.label}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  )
}

function AppAccessUserPicker({
  disabled,
  grantableUsers,
  onValueChange,
  selectedUsers,
  targetId,
  theme,
}: {
  disabled: boolean
  grantableUsers: DesktopContactUser[]
  onValueChange: (users: DesktopContactUser[]) => void
  selectedUsers: DesktopContactUser[]
  targetId: string
  theme: "light" | "dark"
}) {
  const anchor = useComboboxAnchor()
  const portal = useRef<HTMLDivElement>(null)

  return (
    <div className="grid gap-2">
      <Label>可访问用户</Label>
      <Combobox<DesktopContactUser, true>
        disabled={disabled}
        items={grantableUsers}
        multiple
        value={selectedUsers}
        isItemEqualToValue={(user, selected) => user.id.toLowerCase() === selected.id.toLowerCase()}
        itemToStringLabel={(user) => user.nickname.trim() || user.name.trim()}
        itemToStringValue={(user) => user.id}
        filter={(user, query) =>
          `${user.name} ${user.nickname} ${user.email} ${user.phone}`
            .toLowerCase()
            .includes(query.toLowerCase())
        }
        onValueChange={onValueChange}
      >
        <div ref={anchor}>
          <ComboboxChips className="max-h-24 overflow-y-auto">
            {selectedUsers.map((user) => (
              <ComboboxChip key={user.id}>{user.nickname.trim() || user.name.trim()}</ComboboxChip>
            ))}
            <ComboboxChipsInput
              aria-label="选择可访问用户"
              disabled={disabled}
              placeholder={selectedUsers.length ? "继续添加用户" : "搜索并选择用户"}
            />
          </ComboboxChips>
        </div>
        <ComboboxContent anchor={anchor} container={portal}>
          <ComboboxEmpty>没有匹配的用户</ComboboxEmpty>
          <ComboboxList>
            {(user: DesktopContactUser) => (
              <ComboboxItem key={user.id} value={user}>
                <EntityAvatar
                  targetId={targetId}
                  type="user"
                  id={user.id}
                  theme={theme}
                  size={28}
                  label={user.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{user.nickname.trim() || user.name.trim()}</span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <p className="text-xs text-muted-foreground">已选择 {selectedUsers.length} 名用户</p>
      <div className="absolute top-0 left-0 size-0" ref={portal} />
    </div>
  )
}

function sameIds(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  const ids = new Set(right.map((id) => id.toLowerCase()))
  return left.every((id) => ids.has(id.toLowerCase()))
}

function CredentialField({ label, value }: { label: string; value: string }) {
  const { showToast } = useAnimatedToast()
  const inputId = useId()
  const copyLabel = label === "应用 ID" ? "应用 ID " : label

  async function copy() {
    try {
      const result = await window.desktop!.copyText(value)
      if (!result.ok) throw new Error(result.error.message)
      showToast({ title: `${copyLabel}已复制`, status: "success" })
    } catch {
      showToast({ title: `${copyLabel}复制失败`, status: "error" })
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={inputId} className="min-w-0 flex-1 font-mono! text-sm!" readOnly value={value} />
        <Button
          variant="outline"
          size="icon"
          aria-label={`复制${label}`}
          title={`复制${label}`}
          disabled={!value}
          onClick={() => void copy()}
        >
          <Copy aria-hidden />
        </Button>
      </div>
    </div>
  )
}
