import * as React from "react"
import { UserPlus, UsersRound } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  searchContactUsers,
  type ContactUser,
  type FriendRequest,
} from "@/lib/client-data-api"
import { getClientDataErrorMessage } from "@/lib/client-data-state"

export function FriendManagementDialog({
  acceptRequest,
  cancelRequest,
  contacts,
  createRequest,
  ensureUsers,
  incomingRequests,
  onOpenChange,
  open,
  outgoingRequests,
  rejectRequest,
  usersById,
}: {
  acceptRequest: (requestId: string) => Promise<void>
  cancelRequest: (requestId: string) => Promise<void>
  contacts: ContactUser[]
  createRequest: (userId: string) => Promise<void>
  ensureUsers: (userIds: string[]) => Promise<void>
  incomingRequests: FriendRequest[]
  onOpenChange: (open: boolean) => void
  open: boolean
  outgoingRequests: FriendRequest[]
  rejectRequest: (requestId: string) => Promise<void>
  usersById: Readonly<Record<string, ContactUser>>
}) {
  const [query, setQuery] = React.useState("")
  const [resultIds, setResultIds] = React.useState<string[]>([])
  const [searching, setSearching] = React.useState(false)
  const [updatingKey, setUpdatingKey] = React.useState("")
  const requests = [
    ...incomingRequests.map((request) => ({ direction: "incoming" as const, request })),
    ...outgoingRequests.map((request) => ({ direction: "outgoing" as const, request })),
  ].sort(
    (left, right) =>
      Date.parse(right.request.updatedAt) - Date.parse(left.request.updatedAt)
  )
  const friendIds = new Set(contacts.map((friend) => friend.id))
  const pendingIds = new Set([
    ...incomingRequests
      .filter((request) => request.status === "pending")
      .map((request) => request.requesterUserId),
    ...outgoingRequests
      .filter((request) => request.status === "pending")
      .map((request) => request.addresseeUserId),
  ])

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    setSearching(true)
    try {
      const ids = await searchContactUsers(value)
      await ensureUsers(ids)
      setResultIds(ids)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "查找用户失败"))
    } finally {
      setSearching(false)
    }
  }

  async function run(key: string, action: () => Promise<void>, success: string) {
    setUpdatingKey(key)
    try {
      await action()
      toast.success(success)
    } catch (error) {
      toast.error(getClientDataErrorMessage(error, "好友操作失败"))
    } finally {
      setUpdatingKey("")
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新朋友</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSearch}>
          <Input
            aria-label="精确查找用户"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="完整邮箱、手机号或用户 ID"
            value={query}
          />
        </form>

        {resultIds.length > 0 && (
          <div className="grid gap-2">
            {resultIds.map((id) => {
              const user = usersById[id]
              if (!user) return null
              const unavailable = friendIds.has(id) || pendingIds.has(id)
              return (
                <FriendRow
                  action={
                    <Button
                      disabled={unavailable || updatingKey === `add:${id}`}
                      onClick={() =>
                        void run(
                          `add:${id}`,
                          () => createRequest(id),
                          "好友申请已发送"
                        )
                      }
                      size="sm"
                    >
                      <UserPlus />
                      {friendIds.has(id)
                        ? "已是好友"
                        : pendingIds.has(id)
                          ? "申请处理中"
                          : "添加好友"}
                    </Button>
                  }
                  key={id}
                  user={user}
                />
              )
            })}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">好友申请</h3>
          <div className="grid gap-2">
            {requests.map(({ direction, request }) => {
              const userId =
                direction === "incoming"
                  ? request.requesterUserId
                  : request.addresseeUserId
              const user = usersById[userId]
              if (!user) return null
              return (
                <FriendRow
                  action={
                    request.status === "pending" ? (
                      direction === "incoming" ? (
                        <div className="flex gap-2">
                          <Button
                            disabled={updatingKey === request.id}
                            onClick={() =>
                              void run(
                                request.id,
                                () => acceptRequest(request.id),
                                "已添加好友"
                              )
                            }
                            size="sm"
                          >
                            接受
                          </Button>
                          <Button
                            disabled={updatingKey === request.id}
                            onClick={() =>
                              void run(
                                request.id,
                                () => rejectRequest(request.id),
                                "已拒绝好友申请"
                              )
                            }
                            size="sm"
                            variant="outline"
                          >
                            拒绝
                          </Button>
                        </div>
                      ) : (
                        <Button
                          disabled={updatingKey === request.id}
                          onClick={() =>
                            void run(
                              request.id,
                              () => cancelRequest(request.id),
                              "好友申请已取消"
                            )
                          }
                          size="sm"
                          variant="outline"
                        >
                          取消申请
                        </Button>
                      )
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {getRequestStatusLabel(request.status)}
                      </span>
                    )
                  }
                  description={direction === "incoming" ? "请求添加你为好友" : "你发出了好友申请"}
                  key={request.id}
                  user={user}
                />
              )
            })}
            {requests.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
                <UsersRound className="size-8" />
                暂无好友申请
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getRequestStatusLabel(status: FriendRequest["status"]) {
  switch (status) {
    case "accepted":
      return "已通过"
    case "rejected":
      return "已拒绝"
    case "canceled":
      return "已取消"
    default:
      return "等待处理"
  }
}

function FriendRow({
  action,
  description,
  user,
}: {
  action: React.ReactNode
  description?: string
  user: ContactUser
}) {
  const displayName = user.nickname || user.name
  return (
    <div className="flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-md border p-3">
      <Avatar className="size-9">
        {user.avatar && <AvatarImage alt={displayName} src={user.avatar} />}
        <AvatarFallback>{Array.from(displayName)[0] ?? "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate text-sm font-medium">{displayName}</div>
        <div className="truncate text-xs text-muted-foreground">
          {description ?? user.email}
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  )
}
