import * as React from "react"
import { Blocks, Camera, X } from "lucide-react"
import { toast } from "sonner"

import { AppAccessUserCombobox } from "@/components/contacts/app-access-user-combobox"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import type { ContactUser } from "@/lib/client-data-api"
import {
  createClientApp,
  uploadClientAppAvatar,
  type ClientAppCredentials,
  type ClientAppVisibility,
} from "@/lib/client-api/apps"
import {
  prepareAppAvatar,
  type PreparedAppAvatar,
} from "@/lib/app-avatar-processing"
import { cn } from "@/lib/utils"

const visibilityOptions: Array<{
  label: string
  value: ClientAppVisibility
}> = [
  { label: "仅我自己", value: "creator" },
  { label: "所有人", value: "public" },
  { label: "部分用户", value: "restricted" },
]

type CreateAppDialogProps = {
  currentUserId: string
  onCreated: (credentials: ClientAppCredentials) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  users: ContactUser[]
}

export function CreateAppDialog({
  currentUserId,
  onCreated,
  onOpenChange,
  open,
  users,
}: CreateAppDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {open && (
        <CreateAppDialogContent
          currentUserId={currentUserId}
          onCreated={onCreated}
          onOpenChange={onOpenChange}
          users={users}
        />
      )}
    </Dialog>
  )
}

function CreateAppDialogContent({
  currentUserId,
  onCreated,
  onOpenChange,
  users,
}: Pick<
  CreateAppDialogProps,
  "currentUserId" | "onCreated" | "onOpenChange" | "users"
>) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const userComboboxPortal = React.useRef<HTMLDivElement>(null)
  const nameId = React.useId()
  const descriptionId = React.useId()
  const visibilityLabelId = React.useId()
  const [creating, setCreating] = React.useState(false)
  const [description, setDescription] = React.useState("")
  const [name, setName] = React.useState("")
  const [pendingAvatar, setPendingAvatar] =
    React.useState<PreparedAppAvatar | null>(null)
  const [preparingAvatar, setPreparingAvatar] = React.useState(false)
  const [selectedUsers, setSelectedUsers] = React.useState<ContactUser[]>([])
  const [visibility, setVisibility] =
    React.useState<ClientAppVisibility>("creator")
  const grantableUsers = React.useMemo(
    () => users.filter((user) => user.id !== currentUserId),
    [currentUserId, users]
  )
  const canSubmit =
    !creating &&
    !preparingAvatar &&
    name.trim().length > 0 &&
    (visibility !== "restricted" || selectedUsers.length > 0)

  async function handleAvatarChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const sourceFile = event.target.files?.[0]

    event.target.value = ""
    if (!sourceFile) {
      return
    }

    setPreparingAvatar(true)
    try {
      setPendingAvatar(await prepareAppAvatar(sourceFile))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "处理头像失败")
    } finally {
      setPreparingAvatar(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setCreating(true)
    let credentials: ClientAppCredentials

    try {
      credentials = await createClientApp({
        description: description.trim(),
        name: name.trim(),
        userIds:
          visibility === "restricted"
            ? selectedUsers.map((user) => user.id)
            : [],
        visibility,
      })
    } catch (error) {
      setCreating(false)
      toast.error(error instanceof Error ? error.message : "创建应用失败")
      return
    }

    let avatarUploadError: unknown
    if (pendingAvatar) {
      try {
        credentials = {
          ...credentials,
          app: await uploadClientAppAvatar(
            credentials.app.id,
            pendingAvatar.file
          ),
        }
      } catch (error) {
        avatarUploadError = error
      }
    }

    setCreating(false)
    toast.success("应用创建成功")
    if (avatarUploadError) {
      toast.error(
        avatarUploadError instanceof Error
          ? `应用已创建，但头像上传失败：${avatarUploadError.message}`
          : "应用已创建，但头像上传失败"
      )
    }
    onOpenChange(false)
    onCreated(credentials)
  }

  return (
    <DialogContent
      className="max-h-[calc(100vh-2rem)] gap-5 overflow-y-auto sm:max-w-lg"
      onEscapeKeyDown={(event) => {
        if (creating) {
          event.preventDefault()
        }
      }}
      onPointerDownOutside={(event) => event.preventDefault()}
      showCloseButton={false}
    >
      <div className="flex items-start justify-between gap-4">
        <DialogHeader>
          <DialogTitle>创建应用</DialogTitle>
        </DialogHeader>
        <Button
          aria-label="关闭创建应用"
          disabled={creating}
          onClick={() => onOpenChange(false)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>

      <form
        className="grid gap-5"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="flex items-start gap-4">
          <input
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void handleAvatarChange(event)}
            ref={fileInputRef}
            type="file"
          />
          <Button
            aria-label="上传应用头像"
            className="group/avatar-change relative h-auto overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
            disabled={creating || preparingAvatar}
            onClick={() => fileInputRef.current?.click()}
            type="button"
            variant="ghost"
          >
            <Avatar className="size-17 rounded-sm bg-muted after:rounded-sm">
              {pendingAvatar && (
                <AvatarImage
                  alt={name.trim() || "应用头像预览"}
                  className="rounded-sm object-cover"
                  src={pendingAvatar.previewUrl}
                />
              )}
              <AvatarFallback className="rounded-sm">
                <Blocks className="size-5" />
              </AvatarFallback>
            </Avatar>
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/avatar-change:opacity-100 group-focus-visible/avatar-change:opacity-100",
                preparingAvatar && "opacity-100"
              )}
            >
              {preparingAvatar ? <Spinner /> : <Camera className="size-5" />}
            </span>
          </Button>
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={nameId}>应用名称</FieldLabel>
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                className="flex-1"
                disabled={creating}
                id={nameId}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder="输入应用名称"
                required
                value={name}
              />
            </div>
          </Field>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={descriptionId}>应用描述</Label>
          <Textarea
            className="min-h-28 resize-none"
            disabled={creating}
            id={descriptionId}
            maxLength={2000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="简单介绍这个应用的用途"
            value={description}
          />
        </div>

        <div className="grid gap-2">
          <Label id={visibilityLabelId}>访问范围</Label>
          <RadioGroup
            aria-labelledby={visibilityLabelId}
            className="grid gap-2 sm:grid-cols-3"
            disabled={creating}
            onValueChange={(value) =>
              setVisibility(value as ClientAppVisibility)
            }
            value={visibility}
          >
            {visibilityOptions.map((option) => {
              const id = `create-app-visibility-${option.value}`

              return (
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 transition-colors hover:bg-muted",
                    visibility === option.value &&
                      "border-foreground/30 bg-muted"
                  )}
                  htmlFor={id}
                  key={option.value}
                >
                  <RadioGroupItem id={id} value={option.value} />
                  <span className="leading-tight">{option.label}</span>
                </label>
              )
            })}
          </RadioGroup>
        </div>

        {visibility === "restricted" && (
          <div className="grid gap-2">
            <Label>可访问用户</Label>
            <AppAccessUserCombobox
              disabled={creating}
              onValueChange={setSelectedUsers}
              portalContainer={userComboboxPortal}
              users={grantableUsers}
              value={selectedUsers}
            />
            <p className="text-xs text-muted-foreground">
              已选择 {selectedUsers.length} 名用户
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={creating}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            取消
          </Button>
          <Button disabled={!canSubmit} type="submit">
            {creating && <Spinner />}
            创建应用
          </Button>
        </DialogFooter>
      </form>
      <div className="absolute top-0 left-0 size-0" ref={userComboboxPortal} />
    </DialogContent>
  )
}
