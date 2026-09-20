import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import type { DesktopContactUser, DesktopFriendRequest } from "../../../shared/account-data"

export function FriendManagementDialog({
  targetId,
  userId,
  contacts,
  onClose,
  onChanged,
}: {
  targetId: string
  userId: string
  contacts: DesktopContactUser[]
  onClose: () => void
  onChanged: () => void
}) {
  const { showToast } = useAnimatedToast()
  const [view, setView] = useState<"incoming" | "outgoing" | "search">("incoming")
  const [requests, setRequests] = useState<DesktopFriendRequest[]>([])
  const [query, setQuery] = useState("")
  const [users, setUsers] = useState<DesktopContactUser[]>([])
  const [busy, setBusy] = useState("")
  async function load(direction: "incoming" | "outgoing") {
    const result = await window.desktop!.accountData.listFriendRequests({ targetId, direction })
    if (result.ok) setRequests(result.data)
    else showToast({ title: result.error.message, status: "error" })
  }
  useEffect(() => {
    if (view !== "search") void load(view)
  }, [view])
  async function act(action: "create" | "accept" | "reject" | "cancel", id: string) {
    setBusy(id)
    const api = window.desktop!.accountData
    const result =
      action === "create"
        ? await api.createFriendRequest({ targetId, id })
        : action === "accept"
          ? await api.acceptFriendRequest({ targetId, id })
          : action === "reject"
            ? await api.rejectFriendRequest({ targetId, id })
            : await api.cancelFriendRequest({ targetId, id })
    setBusy("")
    if (!result.ok) return showToast({ title: result.error.message, status: "error" })
    showToast({ title: "好友操作成功", status: "success" })
    onChanged()
    if (view !== "search") await load(view)
  }
  return (
    <Modal title="好友管理" onClose={onClose}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        {(["incoming", "outgoing", "search"] as const).map((item) => (
          <Button
            key={item}
            size="sm"
            variant={view === item ? "default" : "secondary"}
            onClick={() => setView(item)}
          >
            {item === "incoming" ? "收到的" : item === "outgoing" ? "发出的" : "查找用户"}
          </Button>
        ))}
      </div>
      {view === "search" ? (
        <>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="姓名、邮箱或手机号"
            />
            <Button
              onClick={async () => {
                const result = await window.desktop!.accountData.searchContactUsers({
                  targetId,
                  query,
                })
                if (result.ok) setUsers(result.data)
                else showToast({ title: result.error.message, status: "error" })
              }}
            >
              搜索
            </Button>
          </div>
          {users.map((user) => (
            <ActionRow
              key={user.id}
              label={user.name}
              action={
                user.id === userId || contacts.some((item) => item.id === user.id)
                  ? "已在通讯录"
                  : "添加"
              }
              disabled={
                busy === user.id ||
                user.id === userId ||
                contacts.some((item) => item.id === user.id)
              }
              onClick={() => void act("create", user.id)}
            />
          ))}
        </>
      ) : (
        requests
          .filter((item) => item.status === "pending")
          .map((request) => (
            <ActionRow
              key={request.id}
              label={view === "incoming" ? request.requesterUserId : request.addresseeUserId}
              action={view === "incoming" ? "接受" : "取消"}
              secondary={view === "incoming" ? "拒绝" : undefined}
              disabled={busy === request.id}
              onClick={() => void act(view === "incoming" ? "accept" : "cancel", request.id)}
              onSecondary={() => void act("reject", request.id)}
            />
          ))
      )}
    </Modal>
  )
}

function ActionRow({
  label,
  action,
  secondary,
  disabled,
  onClick,
  onSecondary,
}: {
  label: string
  action: string
  secondary?: string
  disabled?: boolean
  onClick: () => void
  onSecondary?: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b py-3">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {secondary && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onSecondary}>
          {secondary}
        </Button>
      )}
      <Button size="sm" disabled={disabled} onClick={onClick}>
        {action}
      </Button>
    </div>
  )
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
