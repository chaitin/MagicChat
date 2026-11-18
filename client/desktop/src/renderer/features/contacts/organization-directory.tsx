import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { Building2, ChevronRight, Folder } from "lucide-react"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import { cn } from "@/lib/utils"
import type {
  DesktopContactUser,
  DesktopOrganizationMemberPage,
  DesktopOrganizationSnapshot,
} from "../../../shared/account-data"
import {
  buildOrganizationDirectoryTree,
  matchesOrganizationMember,
  OrganizationMemberPager,
  type OrganizationDirectoryNode,
} from "../../../../../shared/organization-directory"

type Member = DesktopOrganizationMemberPage["members"][number]

export function OrganizationDirectory({
  snapshot,
  contacts,
  targetId,
  theme,
  revision,
  rootUnitId,
  selectedUserId,
  keyword = "",
  onSelect,
}: {
  snapshot: DesktopOrganizationSnapshot
  contacts: DesktopContactUser[]
  targetId: string
  theme: "light" | "dark"
  revision: number
  rootUnitId?: string
  selectedUserId?: string
  keyword?: string
  onSelect: (user: DesktopContactUser) => void
}) {
  const [openNodes, setOpenNodes] = useState<Record<string, boolean>>({})
  const tree = useMemo(() => buildOrganizationDirectoryTree(snapshot), [snapshot])
  const renderMember = (user: DesktopContactUser, key = user.id) => (
    <button
      key={key}
      type="button"
      role="option"
      aria-label={user.nickname || user.name}
      aria-selected={selectedUserId === user.id}
      onClick={() => onSelect(user)}
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selectedUserId === user.id &&
          "bg-xgui-brand-1 font-medium text-sidebar-accent-foreground hover:bg-xgui-brand-1",
      )}
    >
      <span className="size-6 shrink-0 overflow-hidden rounded-sm">
        <EntityAvatar
          targetId={targetId}
          type="user"
          id={user.id}
          theme={theme}
          label={user.nickname || user.name}
          size={24}
        />
      </span>
      <span className="truncate">{user.nickname || user.name}</span>
    </button>
  )
  const renderNode = (node: OrganizationDirectoryNode) => {
    const open = openNodes[node.key] ?? node.defaultOpen
    const Icon = node.kind === "unit" ? Building2 : Folder
    return (
      <div key={node.key} className="space-y-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpenNodes((current) => ({ ...current, [node.key]: !open }))
          }}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/70",
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          />
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
          {typeof node.memberCount === "number" && (
            <span
              className="shrink-0 text-xs tabular-nums text-muted-foreground"
              title="含下级，按可见员工去重"
            >
              ({node.memberCount})
            </span>
          )}
        </button>
        {open && (
          <div className="ml-4 space-y-1 border-l border-border/50 pl-1">
            {node.departmentId && (
              <div className="pl-7">
                <NodeMembers
                  key={`${node.departmentId}:${revision}`}
                  departmentId={node.departmentId}
                  targetId={targetId}
                  contacts={contacts}
                  renderMember={renderMember}
                />
              </div>
            )}
            {node.children.map(renderNode)}
          </div>
        )}
      </div>
    )
  }
  if (keyword.trim()) {
    const matches = contacts.filter((user) => matchesOrganizationMember(user, keyword))
    return (
      <section className="bg-xgui-background-1 px-3 py-1" aria-label="成员搜索结果">
        <div role="listbox" aria-label="成员搜索结果">
          {matches.map((user) => renderMember(user))}
        </div>
        {matches.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">没有匹配的成员</p>
        )}
      </section>
    )
  }
  return (
    <section className="bg-xgui-background-1 py-1" aria-label="组织通讯录">
      <nav aria-label="组织架构" className="mx-3 space-y-1">
        {tree.map((node) =>
          node.key === `unit:${rootUnitId}` ? (
            <div key={node.key} className="ml-4 space-y-1 border-l border-border/50 pl-1">
              {node.departmentId && (
                <div className="pl-7">
                  <NodeMembers
                    key={`${node.departmentId}:${revision}`}
                    departmentId={node.departmentId}
                    targetId={targetId}
                    contacts={contacts}
                    renderMember={renderMember}
                  />
                </div>
              )}
              {node.children.map(renderNode)}
            </div>
          ) : (
            renderNode(node)
          ),
        )}
      </nav>
    </section>
  )
}

function NodeMembers({
  departmentId,
  targetId,
  contacts,
  renderMember,
}: {
  departmentId: string
  targetId: string
  contacts: DesktopContactUser[]
  renderMember: (user: DesktopContactUser) => React.ReactNode
}) {
  const pager = useMemo(
    () =>
      new OrganizationMemberPager<Member>(async (page) => {
        const result = await window.desktop!.accountData.getOrganizationMembers({
          targetId,
          departmentId,
          page,
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      }),
    [departmentId, targetId],
  )
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot)
  useEffect(() => {
    void pager.loadNext()
  }, [pager])
  return (
    <div role="listbox" aria-label="组织成员列表">
      {state.members.map((member) =>
        renderMember(
          contacts.find((user) => user.id === member.id) ?? {
            id: member.id,
            name: member.name,
            nickname: member.nickname,
            email: "",
            phone: "",
            online: false,
            avatarType: "user",
            avatarId: member.id,
          },
        ),
      )}
      {state.loading && (
        <p role="status" className="px-2 py-3 text-xs text-muted-foreground">
          加载成员…
        </p>
      )}
      {state.error && (
        <div role="alert" className="px-2 py-2 text-xs text-muted-foreground">
          {state.error}
          <button
            type="button"
            disabled={state.loading}
            className="ml-2 underline"
            onClick={() => void pager.loadNext()}
          >
            重试
          </button>
        </div>
      )}
      {!state.loading && !state.error && state.page > 0 && !state.members.length && (
        <p className="px-2 py-3 text-xs text-muted-foreground">暂无成员</p>
      )}
      {!state.error && state.members.length < state.total && (
        <button
          type="button"
          disabled={state.loading}
          onClick={() => void pager.loadNext()}
          className="h-8 w-full rounded-md px-2 text-left text-xs hover:bg-muted/70 disabled:opacity-50"
        >
          {state.loading ? "加载中…" : "加载更多成员"}
        </button>
      )}
    </div>
  )
}
