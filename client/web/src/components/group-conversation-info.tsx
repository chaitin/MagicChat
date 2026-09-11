import { useEffect, useId, useRef, useState } from "react"

import {
  Camera,
  Check,
  Globe2,
  Lock,
  LogOut,
  MinusSquare,
  Pencil,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import type { ClientConversationMember } from "@/lib/client-data-api"
import { useClientData } from "@/lib/client-data-context"
import {
  CustomAvatarPicker,
  type CroppedAvatar,
} from "@/components/custom-avatar-picker"
import { GroupAvatar } from "@/components/group-avatar"
import { GroupConversationProjects } from "@/components/group-conversation-projects"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { UserProfilePopover } from "@/components/user-profile-popover"
import {
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type GroupConversationInfoProps = {
  conversationId: string
}

export function GroupConversationInfo({
  conversationId,
}: GroupConversationInfoProps) {
  const {
    dissolveGroupConversation,
    getConversation,
    leaveGroupConversation,
    me,
    projects,
    refreshConversations,
    refreshProjects,
    removeGroupConversationMember,
    setGroupConversationPrivate,
    setGroupConversationPublic,
    updateGroupConversationName,
    updateGroupConversationAnnouncement,
    updateGroupConversationAvatar,
  } = useClientData()
  const [announcementClearConfirmOpen, setAnnouncementClearConfirmOpen] =
    useState(false)
  const [announcementEditorOpen, setAnnouncementEditorOpen] = useState(false)
  const [announcementDraft, setAnnouncementDraft] = useState("")
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const conversation = getConversation(conversationId)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [avatarSaving, setAvatarSaving] = useState(false)
  const [dissolveConfirmOpen, setDissolveConfirmOpen] = useState(false)
  const [dissolveSaving, setDissolveSaving] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [leaveSaving, setLeaveSaving] = useState(false)
  const [memberRemovalSaving, setMemberRemovalSaving] = useState(false)
  const [memberRemovalTarget, setMemberRemovalTarget] =
    useState<ClientConversationMember | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [visibilityTarget, setVisibilityTarget] = useState<
    "private" | "public" | null
  >(null)
  const [draftAvatarOverride, setDraftAvatarOverride] = useState<{
    avatar: string
    baseAvatar: string
    conversationId: string
  } | null>(null)

  if (!conversation) {
    return (
      <>
        <SheetHeader className="border-b">
          <SheetTitle>群聊信息</SheetTitle>
          <SheetDescription>群聊</SheetDescription>
        </SheetHeader>
        <div className="px-4 py-6 text-sm text-muted-foreground">
          会话信息不可用
        </div>
      </>
    )
  }

  const activeConversation = conversation
  const members = [...(activeConversation.members ?? [])].sort(
    compareConversationMembers
  )
  const currentMember = members.find((member) => member.id === me.id)
  const canChangeAvatar = canManageGroupAvatar(currentMember?.role)
  const canManageMembers = canManageGroupMembers(currentMember?.role)
  const canManageProjects = canManageGroupProjects(currentMember?.role)
  const canChangeName = canManageGroupName(currentMember?.role)
  const canChangeAnnouncement = canManageGroupAnnouncement(currentMember?.role)
  const canLeaveGroup = Boolean(currentMember && currentMember.role !== "owner")
  const canDissolveGroup = currentMember?.role === "owner"
  const canChangeVisibility = currentMember?.role === "owner"
  const isPublicGroup = activeConversation.visibility === "public"
  const conversationName = activeConversation.name
  const conversationAvatar = activeConversation.avatar
  const normalizedAnnouncementDraft = announcementDraft.trim()
  const announcementDraftLength = Array.from(normalizedAnnouncementDraft).length
  const announcementDraftTooLong = announcementDraftLength > 200
  const draftAvatar =
    draftAvatarOverride?.conversationId === activeConversation.id &&
    draftAvatarOverride.baseAvatar === conversationAvatar
      ? draftAvatarOverride.avatar
      : conversationAvatar

  async function handleAvatarSave(avatar: CroppedAvatar) {
    if (!canChangeAvatar || avatarSaving) {
      return
    }

    setAvatarSaving(true)
    try {
      const updatedConversation = await updateGroupConversationAvatar(
        activeConversation.id,
        avatar.file
      )
      setDraftAvatarOverride({
        avatar: updatedConversation.avatar,
        baseAvatar: updatedConversation.avatar,
        conversationId: updatedConversation.id,
      })
      setAvatarPickerOpen(false)
      toast.success("群头像已保存")
    } catch (error) {
      toast.error(getErrorMessage(error, "上传群头像失败"))
    } finally {
      setAvatarSaving(false)
    }
  }

  async function handleNameSave(name: string) {
    if (!canChangeName || nameSaving) {
      return
    }

    setNameSaving(true)
    try {
      await updateGroupConversationName(activeConversation.id, name)
      toast.success("群聊名称已保存")
    } catch (error) {
      toast.error(getErrorMessage(error, "修改群聊名称失败"))
      throw error
    } finally {
      setNameSaving(false)
    }
  }

  function openAnnouncementEditor() {
    if (!canChangeAnnouncement || announcementSaving) {
      return
    }
    setAnnouncementDraft(activeConversation.announcement ?? "")
    setAnnouncementEditorOpen(true)
  }

  async function handleAnnouncementSave(announcement: string) {
    if (!canChangeAnnouncement || announcementSaving) {
      return
    }

    setAnnouncementSaving(true)
    try {
      await updateGroupConversationAnnouncement(
        activeConversation.id,
        announcement
      )
      setAnnouncementClearConfirmOpen(false)
      setAnnouncementEditorOpen(false)
      toast.success(announcement.trim() ? "群公告已保存" : "群公告已清空")
    } catch (error) {
      toast.error(getErrorMessage(error, "修改群公告失败"))
    } finally {
      setAnnouncementSaving(false)
    }
  }

  async function handleLeaveGroup() {
    if (!canLeaveGroup || leaveSaving) {
      return
    }

    setLeaveSaving(true)
    try {
      await leaveGroupConversation(activeConversation.id)
      setLeaveConfirmOpen(false)
      toast.success("已退出群聊")
    } catch (error) {
      toast.error(getErrorMessage(error, "退出群聊失败"))
    } finally {
      setLeaveSaving(false)
    }
  }

  async function handleDissolveGroup() {
    if (!canDissolveGroup || dissolveSaving) {
      return
    }

    setDissolveSaving(true)
    try {
      await dissolveGroupConversation(activeConversation.id)
      setDissolveConfirmOpen(false)
      toast.success("已解散群聊")
    } catch (error) {
      toast.error(getErrorMessage(error, "解散群聊失败"))
    } finally {
      setDissolveSaving(false)
    }
  }

  async function handleRemoveMember() {
    if (
      !canManageMembers ||
      !memberRemovalTarget ||
      memberRemovalSaving ||
      (memberRemovalTarget.type === "user" &&
        memberRemovalTarget.id === me.id) ||
      memberRemovalTarget.role === "owner"
    ) {
      return
    }

    const target = memberRemovalTarget
    setMemberRemovalSaving(true)
    try {
      await removeGroupConversationMember(
        activeConversation.id,
        target.id,
        target.type
      )
      setMemberRemovalTarget(null)
      toast.success("已移出群聊成员")
    } catch (error) {
      toast.error(getErrorMessage(error, "移出群聊成员失败"))
    } finally {
      setMemberRemovalSaving(false)
    }
  }

  async function handleVisibilityChange(target: "private" | "public") {
    if (!canChangeVisibility || visibilitySaving) {
      return
    }

    setVisibilitySaving(true)
    try {
      if (target === "public") {
        await setGroupConversationPublic(activeConversation.id)
        toast.success("已设置为公开群")
      } else {
        await setGroupConversationPrivate(activeConversation.id)
        toast.success("已取消公开群")
      }
      setVisibilityTarget(null)
    } catch (error) {
      toast.error(getErrorMessage(error, "更新群公开状态失败"))
    } finally {
      setVisibilitySaving(false)
    }
  }

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle>群聊信息</SheetTitle>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-5">
          <div className="flex justify-center">
            <GroupConversationAvatarControl
              avatar={draftAvatar}
              canChangeAvatar={canChangeAvatar}
              members={members}
              name={conversationName}
              onClick={() => setAvatarPickerOpen(true)}
            />
          </div>

          <GroupConversationNameControl
            canChangeName={canChangeName}
            name={conversationName}
            onSave={handleNameSave}
            saving={nameSaving}
          />

          <GroupConversationAnnouncementControl
            announcement={activeConversation.announcement ?? ""}
            canChange={canChangeAnnouncement}
            onEdit={openAnnouncementEditor}
          />

          <GroupConversationProjects
            availableProjects={projects}
            canManage={canManageProjects}
            conversationId={activeConversation.id}
            key={activeConversation.id}
            linkedProjects={activeConversation.projects ?? []}
            onConversationsChanged={refreshConversations}
            onProjectsChanged={refreshProjects}
          />

          <div className="grid gap-2">
            <Label>群成员（{activeConversation.memberCount}）</Label>
            <div className="grid gap-1">
              {members.map((member) => (
                <GroupMemberItem
                  canRemove={
                    canManageMembers &&
                    (member.type !== "user" || member.id !== me.id) &&
                    member.role !== "owner"
                  }
                  key={`${member.type}:${member.id}`}
                  member={member}
                  onRemove={() => setMemberRemovalTarget(member)}
                />
              ))}
              {members.length === 0 && (
                <div className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无成员信息
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog
        open={avatarPickerOpen}
        onOpenChange={(open) => {
          if (!avatarSaving) {
            setAvatarPickerOpen(open)
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex w-[calc(100vw-2rem)] max-w-2xl flex-col gap-4 rounded-md border bg-background p-5 text-foreground shadow-lg ring-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">
                修改群头像
              </DialogTitle>
              <DialogDescription className="sr-only">
                上传并裁切一张图片作为群聊头像
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                aria-label="关闭群头像选择"
                disabled={avatarSaving}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
          </div>
          <CustomAvatarPicker onSave={handleAvatarSave} saving={avatarSaving} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={announcementEditorOpen}
        onOpenChange={(open) => {
          if (!announcementSaving) {
            setAnnouncementEditorOpen(open)
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogTitle>修改群公告</DialogTitle>
          <DialogDescription>
            群公告为纯文本，最多 200 个字符。清空内容即可移除公告。
          </DialogDescription>
          <div className="grid gap-2">
            <Label htmlFor="group-announcement-editor">群公告</Label>
            <Textarea
              aria-invalid={announcementDraftTooLong}
              className="min-h-32 resize-y"
              disabled={announcementSaving}
              id="group-announcement-editor"
              onChange={(event) => setAnnouncementDraft(event.target.value)}
              placeholder="输入群公告"
              value={announcementDraft}
            />
            <div
              className={
                announcementDraftTooLong
                  ? "text-right text-xs text-destructive"
                  : "text-right text-xs text-muted-foreground"
              }
            >
              {announcementDraftLength}/200
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              disabled={announcementSaving || !activeConversation.announcement}
              onClick={() => setAnnouncementClearConfirmOpen(true)}
              type="button"
              variant="outline"
            >
              清空公告
            </Button>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button
                  disabled={announcementSaving}
                  type="button"
                  variant="outline"
                >
                  取消
                </Button>
              </DialogClose>
              <Button
                disabled={
                  announcementSaving ||
                  announcementDraftTooLong ||
                  normalizedAnnouncementDraft ===
                    (activeConversation.announcement ?? "").trim()
                }
                onClick={() =>
                  void handleAnnouncementSave(normalizedAnnouncementDraft)
                }
                type="button"
              >
                保存
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={announcementClearConfirmOpen}
        onOpenChange={(open) => {
          if (!announcementSaving) {
            setAnnouncementClearConfirmOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空群公告</AlertDialogTitle>
            <AlertDialogDescription>
              确定要清空当前群公告吗？清空后，群聊页面将不再展示公告。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={announcementSaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={
                announcementSaving ||
                !canChangeAnnouncement ||
                !activeConversation.announcement
              }
              onClick={(event) => {
                event.preventDefault()
                void handleAnnouncementSave("")
              }}
              variant="destructive"
            >
              {announcementSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              清空公告
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SheetFooter className="border-t">
        {canChangeVisibility && (
          <Button
            disabled={visibilitySaving}
            onClick={() =>
              setVisibilityTarget(isPublicGroup ? "private" : "public")
            }
            type="button"
            variant="outline"
          >
            {isPublicGroup ? (
              <Lock aria-hidden="true" className="size-4" />
            ) : (
              <Globe2 aria-hidden="true" className="size-4" />
            )}
            {isPublicGroup ? "取消公开群" : "设置为公开群"}
          </Button>
        )}
        {canLeaveGroup && (
          <Button
            disabled={leaveSaving}
            onClick={() => setLeaveConfirmOpen(true)}
            type="button"
            variant="destructive"
          >
            <LogOut aria-hidden="true" className="size-4" />
            退出群聊
          </Button>
        )}
        {canDissolveGroup && (
          <Button
            disabled={dissolveSaving}
            onClick={() => setDissolveConfirmOpen(true)}
            type="button"
            variant="destructive"
          >
            <Trash2 aria-hidden="true" className="size-4" />
            解散群聊
          </Button>
        )}
      </SheetFooter>
      <AlertDialog
        open={leaveConfirmOpen}
        onOpenChange={(open) => {
          if (!leaveSaving) {
            setLeaveConfirmOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出群聊</AlertDialogTitle>
            <AlertDialogDescription>
              退出后将无法继续查看和发送该群聊消息。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveSaving}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={leaveSaving || !canLeaveGroup}
              onClick={(event) => {
                event.preventDefault()
                void handleLeaveGroup()
              }}
              variant="destructive"
            >
              {leaveSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              退出群聊
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={dissolveConfirmOpen}
        onOpenChange={(open) => {
          if (!dissolveSaving) {
            setDissolveConfirmOpen(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认解散群聊</AlertDialogTitle>
            <AlertDialogDescription>
              解散后所有成员都无法继续查看和发送该群聊消息。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dissolveSaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={dissolveSaving || !canDissolveGroup}
              onClick={(event) => {
                event.preventDefault()
                void handleDissolveGroup()
              }}
              variant="destructive"
            >
              {dissolveSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              解散群聊
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={visibilityTarget !== null}
        onOpenChange={(open) => {
          if (!visibilitySaving && !open) {
            setVisibilityTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {visibilityTarget === "private" ? "取消公开群" : "设置为公开群"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {visibilityTarget === "private"
                ? "取消公开后，未加入的用户将不能再从通讯录加入这个群。"
                : "公开以后任何用户都可以加入这个群。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={visibilitySaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={visibilitySaving}
              onClick={(event) => {
                event.preventDefault()
                if (visibilityTarget) {
                  void handleVisibilityChange(visibilityTarget)
                }
              }}
            >
              {visibilitySaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={memberRemovalTarget !== null}
        onOpenChange={(open) => {
          if (!memberRemovalSaving && !open) {
            setMemberRemovalTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移出群聊</AlertDialogTitle>
            <AlertDialogDescription>
              确定要将{" "}
              {memberRemovalTarget
                ? getMemberDisplayName(memberRemovalTarget)
                : "该成员"}{" "}
              移出群聊吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={memberRemovalSaving}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={memberRemovalSaving}
              onClick={(event) => {
                event.preventDefault()
                void handleRemoveMember()
              }}
              variant="destructive"
            >
              {memberRemovalSaving && (
                <span className="mr-1 inline-flex">
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                </span>
              )}
              移出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function GroupConversationNameControl({
  canChangeName,
  name,
  onSave,
  saving,
}: {
  canChangeName: boolean
  name: string
  onSave: (name: string) => Promise<void> | void
  saving: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const trimmedDraftName = draftName.trim()
  const saveDisabled =
    trimmedDraftName === "" || trimmedDraftName === name.trim()

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function startEditing() {
    if (saving) {
      return
    }

    setDraftName(name)
    setEditing(true)
  }

  function cancelEditing() {
    if (saving) {
      return
    }

    setDraftName(name)
    setEditing(false)
  }

  async function saveName() {
    if (saveDisabled || saving) {
      return
    }

    try {
      await onSave(trimmedDraftName)
      setEditing(false)
    } catch {
      return
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={inputId}>群聊名称</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          disabled={!editing || saving}
          id={inputId}
          maxLength={120}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              void saveName()
            }
            if (event.key === "Escape") {
              event.preventDefault()
              cancelEditing()
            }
          }}
          ref={inputRef}
          value={editing ? draftName : name}
        />
        {canChangeName && editing ? (
          <>
            <Button
              aria-label="保存群聊名称"
              disabled={saveDisabled || saving}
              onClick={() => void saveName()}
              size="icon-sm"
              type="button"
            >
              <Check className="size-4" />
            </Button>
            <Button
              aria-label="取消修改群聊名称"
              disabled={saving}
              onClick={cancelEditing}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : canChangeName ? (
          <Button
            aria-label="修改群聊名称"
            disabled={saving}
            onClick={startEditing}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <Pencil className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function GroupConversationAnnouncementControl({
  announcement,
  canChange,
  onEdit,
}: {
  announcement: string
  canChange: boolean
  onEdit: () => void
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>群公告</Label>
        {canChange && (
          <Button
            aria-label="修改群公告"
            onClick={onEdit}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="size-4" />
          </Button>
        )}
      </div>
      <div className="min-h-16 rounded-md border bg-muted/30 px-3 py-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">
        {announcement || "暂无群公告"}
      </div>
    </div>
  )
}

function GroupConversationAvatarControl({
  avatar,
  canChangeAvatar,
  members,
  name,
  onClick,
}: {
  avatar: string
  canChangeAvatar: boolean
  members: ClientConversationMember[]
  name: string
  onClick: () => void
}) {
  const avatarNode = (
    <GroupAvatar
      avatar={avatar}
      className="size-20"
      members={members}
      name={name}
    />
  )

  if (!canChangeAvatar) {
    return avatarNode
  }

  return (
    <Button
      aria-haspopup="dialog"
      aria-label="更换群头像"
      className="group/group-avatar-change relative h-auto overflow-hidden rounded-sm bg-muted p-0 hover:bg-background"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      {avatarNode}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-sm bg-foreground/40 text-background opacity-0 transition-opacity group-hover/group-avatar-change:opacity-100 group-focus-visible/group-avatar-change:opacity-100"
      >
        <Camera className="size-5" />
      </span>
    </Button>
  )
}

function GroupMemberItem({
  canRemove,
  member,
  onRemove,
}: {
  canRemove: boolean
  member: ClientConversationMember
  onRemove: () => void
}) {
  const displayName = getMemberDisplayName(member)
  const content = <GroupMemberItemContent member={member} />

  return (
    <div className="group/member flex min-w-0 items-center gap-1 rounded-md hover:bg-muted">
      {member.type === "user" ? (
        <UserProfilePopover
          fallbackProfile={member}
          triggerClassName="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-sm"
          userId={member.id}
        >
          {content}
        </UserProfilePopover>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5 text-sm">
          {content}
        </div>
      )}
      {canRemove && (
        <Button
          aria-label={`移出 ${displayName}`}
          className="pointer-events-none mr-1 opacity-0 transition-opacity group-hover/member:pointer-events-auto group-hover/member:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
          size="icon-sm"
          title="移出群聊"
          type="button"
          variant="ghost"
        >
          <MinusSquare className="size-4" />
        </Button>
      )}
    </div>
  )
}

function GroupMemberItemContent({
  member,
}: {
  member: ClientConversationMember
}) {
  const displayName = getMemberDisplayName(member)

  return (
    <>
      <Avatar className="size-8 rounded-sm bg-muted after:rounded-sm">
        {member.avatar && (
          <AvatarImage
            alt={displayName}
            className="rounded-sm"
            src={member.avatar}
          />
        )}
        <AvatarFallback className="rounded-sm">
          {getInitial(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {getMemberRoleLabel(member)}
        </div>
      </div>
    </>
  )
}

function getMemberDisplayName(
  member: Pick<ClientConversationMember, "name" | "nickname">
) {
  return member.nickname.trim() || member.name.trim()
}

function getMemberRoleLabel(member: ClientConversationMember) {
  if (member.type === "app") {
    return "应用"
  }
  if (member.role === "owner") {
    return "群主"
  }
  if (member.role === "admin") {
    return "管理员"
  }

  return "成员"
}

function compareConversationMembers(
  left: ClientConversationMember,
  right: ClientConversationMember
) {
  return getConversationMemberOrder(left) - getConversationMemberOrder(right)
}

function getConversationMemberOrder(member: ClientConversationMember) {
  if (member.role === "owner") {
    return 0
  }
  if (member.role === "admin") {
    return 1
  }
  if (member.type === "app") {
    return 2
  }

  return 3
}

function canManageGroupAvatar(
  role: ClientConversationMember["role"] | undefined
) {
  return role === "owner" || role === "admin"
}

function canManageGroupName(
  role: ClientConversationMember["role"] | undefined
) {
  return role === "owner" || role === "admin" || role === "member"
}

function canManageGroupAnnouncement(
  role: ClientConversationMember["role"] | undefined
) {
  return role === "owner" || role === "admin"
}

function canManageGroupMembers(
  role: ClientConversationMember["role"] | undefined
) {
  return role === "owner" || role === "admin"
}

function canManageGroupProjects(
  role: ClientConversationMember["role"] | undefined
) {
  return role === "owner" || role === "admin"
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
