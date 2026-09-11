import { useState } from "react"
import { Loader2Icon, X } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  CustomAvatarPicker,
  type CroppedAvatar,
} from "@/components/custom-avatar-picker"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const builtinAvatars = Array.from({ length: 64 }, (_, index) => {
  const id = String(index + 1).padStart(2, "0")

  return {
    id,
    src: `/assets/avatars/builtin/${id}.webp`,
  }
})

type AvatarPickerDialogProps = {
  onOpenChange: (open: boolean) => void
  onSaveAvatar: (avatar: string) => Promise<void> | void
  onSaveCustomAvatar?: (
    avatar: CroppedAvatar
  ) => Promise<string | void> | string | void
  open: boolean
  selectedAvatar: string
}

export function AvatarPickerDialog({
  onOpenChange,
  onSaveAvatar,
  onSaveCustomAvatar,
  open,
  selectedAvatar,
}: AvatarPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <AvatarPickerDialogContent
          onOpenChange={onOpenChange}
          onSaveAvatar={onSaveAvatar}
          onSaveCustomAvatar={onSaveCustomAvatar}
          selectedAvatar={selectedAvatar}
        />
      )}
    </Dialog>
  )
}

function AvatarPickerDialogContent({
  onOpenChange,
  onSaveAvatar,
  onSaveCustomAvatar,
  selectedAvatar,
}: Omit<AvatarPickerDialogProps, "open">) {
  const [mode, setMode] = useState<"builtin" | "custom">(
    isBuiltinAvatar(selectedAvatar) ? "builtin" : "custom"
  )
  const [draftAvatar, setDraftAvatar] = useState(selectedAvatar)
  const [saving, setSaving] = useState(false)
  const builtinAvatarSelected = isBuiltinAvatar(draftAvatar)

  async function handleSave() {
    if (!builtinAvatarSelected) {
      return
    }

    setSaving(true)

    try {
      await onSaveAvatar(draftAvatar)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleCustomAvatarSave(avatar: CroppedAvatar) {
    setSaving(true)

    try {
      await onSaveCustomAvatar?.(avatar)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      className="flex w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 rounded-md border bg-background p-5 text-foreground shadow-lg ring-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogTitle className="text-base font-medium">选择头像</DialogTitle>
          <DialogDescription className="sr-only">
            选择一个头像作为个人头像
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <Button
            aria-label="关闭头像选择"
            disabled={saving}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>
      </div>

      <Tabs
        value={mode}
        onValueChange={(value) => setMode(value as "builtin" | "custom")}
      >
        <TabsList>
          <TabsTrigger disabled={saving} value="builtin">
            系统头像
          </TabsTrigger>
          <TabsTrigger disabled={saving} value="custom">
            自定义头像
          </TabsTrigger>
        </TabsList>

        <TabsContent className="grid gap-4" value="builtin">
          <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto rounded-md border bg-muted/30 p-2 sm:grid-cols-8">
            {builtinAvatars.map((item) => {
              const selected = draftAvatar === item.src

              return (
                <Button
                  aria-label={`选择头像 ${item.id}`}
                  aria-pressed={selected}
                  className="h-auto rounded-sm bg-background p-0.5 hover:bg-background data-[pressed=true]:ring-2 data-[pressed=true]:ring-ring"
                  data-pressed={selected}
                  disabled={saving}
                  key={item.id}
                  onClick={() => setDraftAvatar(item.src)}
                  type="button"
                  variant="ghost"
                >
                  <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
                    <AvatarImage alt="" className="rounded-sm" src={item.src} />
                    <AvatarFallback className="rounded-sm text-xs">
                      {item.id}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              )
            })}
          </div>

          <div className="flex justify-end">
            <Button
              disabled={saving || !builtinAvatarSelected}
              onClick={() => void handleSave()}
              type="button"
            >
              {saving && (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              )}
              保存
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="custom">
          <CustomAvatarPicker onSave={handleCustomAvatarSave} saving={saving} />
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}

function isBuiltinAvatar(avatar: string) {
  return (
    avatar.startsWith("/assets/avatars/builtin/") && avatar.endsWith(".webp")
  )
}
