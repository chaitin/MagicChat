import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { Button as BeButton } from "@/components/motion/button/base"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DesktopContactDirectory } from "../../../shared/account-data"

type ProfileType = "user" | "app" | "group"

type ProfileContextValue = {
  targetId: string
  currentUserId: string
  currentUserName: string
  currentUserEmail: string
  theme: "light" | "dark"
  onOpenConversation: (type: "user" | "app", id: string) => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

export function ContactProfileProvider({
  children,
  ...value
}: ProfileContextValue & { children: ReactNode }) {
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function ContactProfilePopover({
  children,
  type,
  id,
  fallbackName = "",
  fallbackMemberCount,
  triggerClassName,
}: {
  children: ReactNode
  type: ProfileType
  id: string
  fallbackName?: string
  fallbackMemberCount?: number
  triggerClassName?: string
}) {
  const context = useContext(ProfileContext)
  if (!context || !id) return <>{children}</>
  return (
    <ActiveContactProfilePopover
      {...context}
      type={type}
      id={id}
      fallbackName={fallbackName}
      fallbackMemberCount={fallbackMemberCount}
      triggerClassName={triggerClassName}
    >
      {children}
    </ActiveContactProfilePopover>
  )
}

function ActiveContactProfilePopover({
  children,
  type,
  id,
  fallbackName,
  fallbackMemberCount,
  triggerClassName,
  targetId,
  currentUserId,
  currentUserName,
  currentUserEmail,
  theme,
  onOpenConversation,
}: ProfileContextValue & {
  children: ReactNode
  type: ProfileType
  id: string
  fallbackName: string
  fallbackMemberCount?: number
  triggerClassName?: string
}) {
  const { showToast } = useAnimatedToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [openingAvatar, setOpeningAvatar] = useState(false)
  const [snapshot, setSnapshot] = useState<{
    targetId: string
    data: DesktopContactDirectory
  } | null>(null)
  const [friendState, setFriendState] = useState<{
    key: string
    kind: "incoming" | "outgoing" | "none" | "unavailable"
    requestId?: string
  } | null>(null)
  const key = `${targetId}:${type}:${id.toLowerCase()}`
  const directory = snapshot?.targetId === targetId ? snapshot.data : null
  const matches = (entry: { id: string }) => entry.id.toLowerCase() === id.toLowerCase()
  const user = type === "user" ? directory?.users.find(matches) : undefined
  const app = type === "app" ? directory?.apps.find(matches) : undefined
  const group = type === "group" ? directory?.groups.find(matches) : undefined
  const isSelf = type === "user" && id.toLowerCase() === currentUserId.toLowerCase()
  const name =
    (user && (user.nickname || user.name)) ||
    app?.name ||
    group?.name ||
    (isSelf && currentUserName) ||
    fallbackName ||
    (type === "user" ? "用户" : type === "app" ? "应用" : "群聊")

  useEffect(() => {
    if (!open || !window.desktop) return
    let cancelled = false
    void window.desktop.accountData
      .getContacts(targetId)
      .then((result) => {
        if (cancelled) return
        if (result.ok) setSnapshot({ targetId, data: result.data })
        else showToast({ title: result.error.message, status: "error" })
      })
      .catch(() => {
        if (!cancelled) showToast({ title: "无法读取联系人资料", status: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [open, targetId, showToast])

  useEffect(() => {
    if (!open || !directory || directory.mode !== "friends" || type !== "user" || user || isSelf)
      return
    let cancelled = false
    void Promise.all([
      window.desktop!.accountData.listFriendRequests({ targetId, direction: "incoming" }),
      window.desktop!.accountData.listFriendRequests({ targetId, direction: "outgoing" }),
    ])
      .then(([incoming, outgoing]) => {
        if (cancelled) return
        if (!incoming.ok || !outgoing.ok) {
          setFriendState({ key, kind: "unavailable" })
          return
        }
        const request = incoming.data.find(
          (item) =>
            item.status === "pending" && item.requesterUserId.toLowerCase() === id.toLowerCase(),
        )
        const sent = outgoing.data.some(
          (item) =>
            item.status === "pending" && item.addresseeUserId.toLowerCase() === id.toLowerCase(),
        )
        setFriendState({
          key,
          kind: request ? "incoming" : sent ? "outgoing" : "none",
          requestId: request?.id,
        })
      })
      .catch(() => {
        if (!cancelled) setFriendState({ key, kind: "unavailable" })
      })
    return () => {
      cancelled = true
    }
  }, [open, directory, type, user, isSelf, key, id, targetId])

  async function openAvatarPreview() {
    if (openingAvatar) return
    setOpeningAvatar(true)
    try {
      const avatar = await window.desktop!.accountData.getAvatar({ targetId, type, id, theme })
      if (!avatar.ok) throw new Error(avatar.error.message)
      if (avatar.data.status !== "ready") {
        showToast({ title: "暂无可预览的头像", status: "info" })
        return
      }
      setOpen(false)
      const result = await window.desktop!.media.openPreview({
        targetId,
        avatar: { type, id, theme },
        conversationName: name,
      })
      if (!result.ok) throw new Error(result.error.message)
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "头像预览失败", status: "error" })
    } finally {
      setOpeningAvatar(false)
    }
  }

  async function handleAction() {
    if (busy || isSelf || type === "group") return
    setBusy(true)
    try {
      if (type === "user" && directory?.mode === "friends" && !user) {
        const state = friendState?.key === key ? friendState : null
        if (!state || (state.kind !== "incoming" && state.kind !== "none")) return
        const result =
          state.kind === "incoming"
            ? await window.desktop!.accountData.acceptFriendRequest({
                targetId,
                id: state.requestId!,
              })
            : await window.desktop!.accountData.createFriendRequest({ targetId, id })
        if (!result.ok) throw new Error(result.error.message)
        if (state.kind === "incoming") {
          showToast({ title: "已添加好友", status: "success" })
          setOpen(false)
        } else {
          setFriendState({ key, kind: "outgoing" })
          showToast({ title: "好友申请已发送", status: "success" })
        }
        return
      }
      await onOpenConversation(type, id)
      setOpen(false)
    } catch (error) {
      showToast({ title: error instanceof Error ? error.message : "操作失败", status: "error" })
    } finally {
      setBusy(false)
    }
  }

  const state = friendState?.key === key ? friendState : null
  const canMessage = type === "app" || (type === "user" && !isSelf && Boolean(user))
  const canRequest = type === "user" && !isSelf && directory?.mode === "friends" && !user
  const canAct =
    canMessage || (canRequest && (state?.kind === "incoming" || state?.kind === "none"))
  const actionLabel = canRequest
    ? state?.kind === "incoming"
      ? "接受好友申请"
      : state?.kind === "outgoing"
        ? "已发送好友申请"
        : state?.kind === "unavailable"
          ? "好友状态不可用"
          : state?.kind === "none"
            ? "加好友"
            : "正在查询好友状态…"
    : "发消息"
  const details: Array<{ label: string; value: string | undefined }> =
    type === "user"
      ? [
          { label: "姓名", value: user?.name || (isSelf ? currentUserName : fallbackName) },
          { label: "昵称", value: user?.nickname },
          { label: "邮箱", value: user?.email || (isSelf ? currentUserEmail : "") },
          { label: "电话", value: user?.phone },
          { label: "状态", value: user ? (user.online ? "在线" : "离线") : undefined },
        ]
      : type === "app"
        ? [
            { label: "描述", value: app?.description },
            { label: "状态", value: app ? (app.online ? "在线" : "离线") : undefined },
          ]
        : [
            {
              label: "成员",
              value:
                group || fallbackMemberCount !== undefined
                  ? `${group?.memberCount ?? fallbackMemberCount} 人`
                  : undefined,
            },
            { label: "状态", value: group ? (group.joined ? "已加入" : "未加入") : undefined },
            {
              label: "可见性",
              value:
                group?.visibility === "public"
                  ? "公开"
                  : group?.visibility === "private"
                    ? "私有"
                    : undefined,
            },
          ]
  const visibleDetails = details.filter((detail): detail is { label: string; value: string } =>
    Boolean(detail.value?.trim()),
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={`${name}资料`}
        className={cn(
          "inline-flex shrink-0 cursor-pointer appearance-none rounded-sm bg-transparent p-0 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          triggerClassName,
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={8}
        className="w-72 max-w-[calc(100vw-2rem)]"
      >
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label={`预览${name}头像`}
              className="shrink-0 cursor-zoom-in rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait"
              disabled={openingAvatar}
              onClick={() => void openAvatarPreview()}
            >
              <EntityAvatar
                targetId={targetId}
                type={type}
                id={id}
                theme={theme}
                size={56}
                label={name}
              />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium" title={name}>
                {name}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {type === "user"
                  ? "用户资料"
                  : type === "app"
                    ? app?.description || "应用资料"
                    : "群聊资料"}
              </div>
            </div>
          </div>
          {visibleDetails.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border px-3 py-1 text-sm">
              {visibleDetails.map((detail) => (
                <ProfileDetail key={detail.label} label={detail.label} value={detail.value} />
              ))}
            </div>
          )}
          {(canMessage || canRequest || isSelf) && (
            <BeButton
              type="button"
              className="w-full bg-xgui-brand text-background hover:bg-xgui-brand-4 hover:text-background active:bg-xgui-brand-5"
              disabled={busy || !canAct}
              onClick={() => void handleAction()}
            >
              {busy ? "处理中…" : actionLabel}
            </BeButton>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-3 py-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 break-words text-right">{value}</span>
    </div>
  )
}
