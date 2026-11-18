import { useEffect, useState, type ReactNode } from "react"
import { Loader2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar"
import {
  getClientOrganizationMembers,
  type ClientOrganizationMember,
} from "@/lib/client-api/organization"
import type { ContactUser } from "@/lib/client-data-api"

export function OrganizationNodeMembers({
  departmentId,
  contacts,
  renderMember,
}: {
  departmentId: string
  contacts: ContactUser[]
  renderMember: (contact: ContactUser) => ReactNode
}) {
  const [members, setMembers] = useState<ClientOrganizationMember[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    void getClientOrganizationMembers(departmentId, page)
      .then((result) => {
        if (!active) return
        setMembers((current) =>
          page === 1
            ? result.members
            : [
                ...current.filter(
                  (member) =>
                    !result.members.some((item) => item.id === member.id)
                ),
                ...result.members,
              ]
        )
        setTotal(result.total)
      })
      .catch(() => {
        if (active) setError("加载成员失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [departmentId, page, retry])
  return (
    <SidebarMenu
      aria-label="组织成员列表"
      className="gap-1 px-0 pb-0"
      role="listbox"
    >
      {error ? (
        <SidebarMenuItem>
          <div role="alert" className="px-2 py-3 text-xs text-muted-foreground">
            {error}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError("")
                setLoading(true)
                setRetry((value) => value + 1)
              }}
            >
              重试
            </Button>
          </div>
        </SidebarMenuItem>
      ) : loading && members.length === 0 ? (
        <SidebarMenuItem>
          <div
            role="status"
            className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
          >
            <Loader2Icon className="size-3.5 animate-spin" />
            加载成员…
          </div>
        </SidebarMenuItem>
      ) : members.length === 0 ? (
        <SidebarMenuItem>
          <p className="px-2 py-3 text-xs text-muted-foreground">暂无成员</p>
        </SidebarMenuItem>
      ) : (
        members.map((member) =>
          renderMember(
            contacts.find((contact) => contact.id === member.id) ?? {
              id: member.id,
              name: member.name,
              nickname: member.nickname,
              avatar: member.avatar,
              email: "",
              phone: "",
              online: false,
              lastOnlineAt: null,
              type: "user",
            }
          )
        )
      )}
      {members.length < total && !error && (
        <SidebarMenuItem>
          <Button
            className="w-full"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setPage((value) => value + 1)
            }}
          >
            {loading ? "加载中…" : "加载更多成员"}
          </Button>
        </SidebarMenuItem>
      )}
    </SidebarMenu>
  )
}
