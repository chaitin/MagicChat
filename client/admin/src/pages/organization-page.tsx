import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { retainSelectedUsers } from "@/lib/organization-selected-users"
import MembersPage, { type Member } from "@/pages/members-page"
import { MemberOrganizationMemberships } from "@/components/member-organization-memberships"
import { MemberJobTitleInput } from "@/components/member-job-title-input"
import {
  MemberProfileFields,
  type MemberProfileDraft,
} from "@/components/member-profile-form"
import {
  getInfoSettings,
  type ContactDirectoryMode,
} from "@/lib/admin-settings"
import {
  getMemberDepartmentIDs,
  getSearchedMemberDepartmentIDs,
} from "@/lib/organization-member-scope"
import { Button } from "@/components/ui/button"
import { departmentPath, unitPath } from "@/lib/organization-paths"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  ComboboxTrigger,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Building2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  MoreHorizontalIcon,
  UsersRoundIcon,
} from "lucide-react"
import {
  createOrganizationDepartment,
  createOrganizationUnit,
  deleteOrganizationDepartment,
  deleteOrganizationUnit,
  getOrganization,
  getOrganizationAssignments,
  getOrganizationPolicy,
  setOrganizationPolicy,
  setOrganizationUnitLeader,
  setOrganizationDepartmentLeaders,
  updateOrganizationDepartment,
  updateOrganizationUnit,
  type OrganizationAssignmentInput,
  type OrganizationReporting,
  type OrganizationDepartment,
  type OrganizationSnapshot,
  type OrganizationPolicy,
  type OrganizationUnit,
} from "@/lib/admin-organization"
import {
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
} from "@/lib/admin-users"

type Selected = { kind: "unit" | "department"; id: string }

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败"
}

function filterOrganizationTree(
  snapshot: OrganizationSnapshot,
  scopeUnitID: string,
  search: string
) {
  const unitsByID = new Map(snapshot.units.map((unit) => [unit.id, unit]))
  const departmentsByID = new Map(
    snapshot.departments.map((department) => [department.id, department])
  )
  const inScope = (id: string) => {
    if (!scopeUnitID) return true
    const seen = new Set<string>()
    let currentID: string | null = id
    while (currentID && !seen.has(currentID)) {
      if (currentID === scopeUnitID) return true
      seen.add(currentID)
      currentID = unitsByID.get(currentID)?.parent_id ?? null
    }
    return false
  }
  const scopedUnits = snapshot.units.filter((unit) => inScope(unit.id))
  const scopedUnitIDs = new Set(scopedUnits.map((unit) => unit.id))
  const keyword = search.trim().toLocaleLowerCase()
  if (!keyword) {
    return {
      units: scopedUnits,
      departmentIDs: new Set(
        snapshot.departments
          .filter((department) => scopedUnitIDs.has(department.unit_id))
          .map((department) => department.id)
      ),
      preferred: scopedUnits[0]
        ? ({ kind: "unit", id: scopedUnits[0].id } as Selected)
        : null,
    }
  }

  const matchedUnits = scopedUnits.filter((unit) =>
    unit.name.toLocaleLowerCase().includes(keyword)
  )
  const matchedDepartments = snapshot.departments.filter(
    (department) =>
      scopedUnitIDs.has(department.unit_id) &&
      department.name.toLocaleLowerCase().includes(keyword)
  )
  const visibleUnitIDs = new Set<string>()
  const visibleDepartmentIDs = new Set<string>()
  const addUnitAncestors = (id: string) => {
    const seen = new Set<string>()
    let currentID: string | null = id
    while (currentID && scopedUnitIDs.has(currentID) && !seen.has(currentID)) {
      seen.add(currentID)
      visibleUnitIDs.add(currentID)
      currentID = unitsByID.get(currentID)?.parent_id ?? null
    }
  }
  for (const unit of matchedUnits) addUnitAncestors(unit.id)
  for (const department of matchedDepartments) {
    addUnitAncestors(department.unit_id)
    const seen = new Set<string>()
    let currentID: string | null = department.id
    while (currentID && !seen.has(currentID)) {
      seen.add(currentID)
      visibleDepartmentIDs.add(currentID)
      currentID = departmentsByID.get(currentID)?.parent_id ?? null
    }
  }
  return {
    units: scopedUnits.filter((unit) => visibleUnitIDs.has(unit.id)),
    departmentIDs: visibleDepartmentIDs,
    preferred: matchedUnits[0]
      ? ({ kind: "unit", id: matchedUnits[0].id } as Selected)
      : matchedDepartments[0]
        ? ({ kind: "department", id: matchedDepartments[0].id } as Selected)
        : null,
  }
}

type OrganizationOption = { value: string; label: string }

function OrganizationSelect({
  label,
  value,
  options,
  onChange,
  className = "mt-1",
}: {
  label: string
  value: string
  options: OrganizationOption[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Select onValueChange={(next) => onChange(next ?? "")} value={value}>
      <SelectTrigger aria-label={label} className={`w-full ${className}`}>
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? "请选择"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ReportingMemberSelect({
  label,
  users,
  value,
  multiple = false,
  onChange,
  onSearch,
  onLoadMore,
  disabled,
}: {
  label: string
  users: AdminUser[]
  value: string[]
  multiple?: boolean
  onChange: (ids: string[]) => void
  onSearch: (query: string) => void
  onLoadMore?: () => void
  disabled: boolean
}) {
  const anchor = useComboboxAnchor()
  const selected = users.filter((user) => value.includes(user.id))
  return (
    <Combobox
      multiple={multiple}
      items={users}
      value={multiple ? selected : (selected[0] ?? null)}
      itemToStringLabel={(user: AdminUser) => user.name || user.email}
      isItemEqualToValue={(a: AdminUser, b: AdminUser) => a.id === b.id}
      filter={(user: AdminUser, query: string) =>
        [user.name, user.email, user.phone].some((text) =>
          text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
        )
      }
      onInputValueChange={(query, details) => {
        if (
          details.reason === "input-change" ||
          details.reason === "input-clear"
        )
          onSearch(query)
      }}
      onValueChange={(next) => {
        const selectedUsers = Array.isArray(next) ? next : next ? [next] : []
        onChange(selectedUsers.map((user) => user.id))
      }}
      onOpenChange={(open) => {
        if (!open) onSearch("")
      }}
      disabled={disabled}
    >
      {multiple ? (
        <ComboboxChips
          ref={anchor}
          className="relative mt-1 min-w-0 py-1 pr-9 has-data-[slot=combobox-chip]:pr-9"
        >
          {selected.map((user) => (
            <ComboboxChip key={user.id}>{user.name || user.email}</ComboboxChip>
          ))}
          <ComboboxChipsInput
            aria-label={label}
            placeholder="输入筛选"
            className="h-6 min-w-0 text-base placeholder:text-muted-foreground md:text-sm"
          />
          <ComboboxTrigger
            aria-label={`展开${label}`}
            className="absolute top-4.5 right-2 -translate-y-1/2"
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
              />
            }
          />
        </ComboboxChips>
      ) : (
        <ComboboxInput
          aria-label={label}
          className="mt-1 w-full"
          placeholder="输入筛选"
          showClear
        />
      )}
      <ComboboxContent anchor={multiple ? anchor : undefined}>
        <ComboboxEmpty>没有匹配的成员</ComboboxEmpty>
        <ComboboxList>
          {(user: AdminUser) => (
            <ComboboxItem key={user.id} value={user}>
              <div className="min-w-0">
                <div className="truncate">{user.name || user.email}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {user.email || user.phone}
                </div>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
        {onLoadMore && (
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            onClick={onLoadMore}
          >
            加载更多
          </Button>
        )}
      </ComboboxContent>
    </Combobox>
  )
}

function OrganizationTree({
  snapshot,
  visibleTree,
  selected,
  search,
  onSelect,
  onConfigure,
  onDelete,
  busy,
  onCreateUnit,
  onCreateDepartment,
}: {
  snapshot: OrganizationSnapshot
  visibleTree: ReturnType<typeof filterOrganizationTree>
  selected: Selected | null
  search: string
  onSelect: (selected: Selected) => void
  onConfigure: (selected: Selected) => void
  onDelete: (selected: Selected, name: string) => void
  busy: boolean
  onCreateUnit: (parentUnitID: string) => void
  onCreateDepartment: (unitID: string, parentDepartmentID: string) => void
}) {
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set())
  const [collapsedDepartments, setCollapsedDepartments] = useState<Set<string>>(
    new Set()
  )
  const searchActive = Boolean(search.trim())

  const { unitsByParent, departmentsByParent } = useMemo(() => {
    const unitsByParent = new Map<string, OrganizationUnit[]>()
    const departmentsByParent = new Map<string, OrganizationDepartment[]>()
    const visibleUnitIDs = new Set(visibleTree.units.map((unit) => unit.id))
    for (const unit of visibleTree.units) {
      const parentID =
        unit.parent_id && visibleUnitIDs.has(unit.parent_id)
          ? unit.parent_id
          : ""
      const siblings = unitsByParent.get(parentID) ?? []
      siblings.push(unit)
      unitsByParent.set(parentID, siblings)
    }
    for (const department of snapshot.departments) {
      if (!visibleTree.departmentIDs.has(department.id)) continue
      const parentID = department.parent_id ?? `root:${department.unit_id}`
      const siblings = departmentsByParent.get(parentID) ?? []
      siblings.push(department)
      departmentsByParent.set(parentID, siblings)
    }
    return { unitsByParent, departmentsByParent }
  }, [snapshot, visibleTree])

  function toggleUnit(id: string) {
    setCollapsedUnits((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleDepartment(id: string) {
    setCollapsedDepartments((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderDepartment(
    department: OrganizationDepartment,
    ancestors: Set<string>
  ) {
    if (ancestors.has(department.id)) return null
    const name = department.name
    const children = departmentsByParent.get(department.id) ?? []
    if (department.is_root) {
      return (
        <div key={department.id} className="space-y-1">
          {children.map((child) =>
            renderDepartment(child, new Set(ancestors).add(department.id))
          )}
        </div>
      )
    }
    const hasChildren = !department.is_root && children.length > 0
    const expanded = searchActive || !collapsedDepartments.has(department.id)
    const nextAncestors = new Set(ancestors).add(department.id)
    return (
      <div key={department.id} className="space-y-1">
        <div
          className={`flex min-h-9 items-center rounded-md ${selected?.kind === "department" && selected.id === department.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"}`}
        >
          {hasChildren ? (
            <button
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"}${name}`}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => toggleDepartment(department.id)}
              type="button"
            >
              {expanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            className={`flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left ${department.is_root ? "text-muted-foreground" : ""}`}
            onClick={() => onSelect({ kind: "department", id: department.id })}
            title={
              department.is_root
                ? `${snapshot.units.find((unit) => unit.id === department.unit_id)?.name ?? ""} · 直属成员`
                : departmentPath(department, snapshot)
            }
            type="button"
          >
            {department.is_root ? (
              <UsersRoundIcon className="size-4 shrink-0" />
            ) : (
              <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{name}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`${name}的更多操作`}
                  className="mr-1 shrink-0 text-muted-foreground hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setCollapsedDepartments((current) => {
                    const next = new Set(current)
                    next.delete(department.id)
                    return next
                  })
                  onCreateDepartment(department.unit_id, department.id)
                }}
              >
                新建子部门
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onConfigure({ kind: "department", id: department.id })
                }
              >
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  onDelete(
                    { kind: "department", id: department.id },
                    department.name
                  )
                }
              >
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {department.is_root &&
          children.map((child) => renderDepartment(child, nextAncestors))}
        {hasChildren && expanded && (
          <div className="ml-2.5 space-y-1 border-l border-border/80 pl-2">
            {children.map((child) => renderDepartment(child, nextAncestors))}
          </div>
        )}
      </div>
    )
  }

  function renderUnit(unit: OrganizationUnit, ancestors: Set<string>) {
    if (ancestors.has(unit.id)) return null
    const departments = departmentsByParent.get(`root:${unit.id}`) ?? []
    const childUnits = unitsByParent.get(unit.id) ?? []
    const hasChildren = departments.length > 0 || childUnits.length > 0
    const expanded = searchActive || !collapsedUnits.has(unit.id)
    const nextAncestors = new Set(ancestors).add(unit.id)
    return (
      <div key={unit.id} className="space-y-1">
        <div
          className={`flex min-h-9 items-center rounded-md ${selected?.kind === "unit" && selected.id === unit.id ? "bg-accent text-accent-foreground" : "hover:bg-muted/70"}`}
        >
          {hasChildren ? (
            <button
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"}${unit.name}`}
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => toggleUnit(unit.id)}
              type="button"
            >
              {expanded ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left font-medium"
            onClick={() => onSelect({ kind: "unit", id: unit.id })}
            title={unitPath(unit.id, snapshot)}
            type="button"
          >
            <Building2Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{unit.name}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">
              {unit.kind === "group"
                ? "集团"
                : unit.kind === "subsidiary"
                  ? "子公司"
                  : "事业部"}
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={`${unit.name}的更多操作`}
                  className="mr-1 shrink-0 text-muted-foreground hover:text-foreground"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setCollapsedUnits((current) => {
                    const next = new Set(current)
                    next.delete(unit.id)
                    return next
                  })
                  onCreateUnit(unit.id)
                }}
              >
                新建子单位
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onCreateDepartment(
                    unit.id,
                    snapshot.departments.find(
                      (department) =>
                        department.unit_id === unit.id && department.is_root
                    )?.id ?? ""
                  )
                }
              >
                新建子部门
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onConfigure({ kind: "unit", id: unit.id })}
              >
                编辑
              </DropdownMenuItem>
              {unit.kind !== "group" && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    onDelete({ kind: "unit", id: unit.id }, unit.name)
                  }
                >
                  删除
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasChildren && expanded && (
          <div className="ml-2.5 space-y-1 border-l border-border/80 pl-2">
            {departments.map((department) =>
              renderDepartment(department, new Set())
            )}
            {childUnits.map((child) => renderUnit(child, nextAncestors))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="organization-tree-scroll min-h-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-2">
      {(unitsByParent.get("") ?? []).map((unit) => renderUnit(unit, new Set()))}
      {visibleTree.units.length === 0 && (
        <p className="px-2 py-4 text-center text-muted-foreground">
          没有匹配的单位或部门
        </p>
      )}
    </div>
  )
}

export default function OrganizationPage() {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null)
  const [policy, setPolicy] = useState<OrganizationPolicy>({
    visibility_scope: "all",
  })
  const [policyDraft, setPolicyDraft] = useState<OrganizationPolicy>(policy)
  const [policyOpen, setPolicyOpen] = useState(false)
  const [createUnitOpen, setCreateUnitOpen] = useState(false)
  const [createDepartmentOpen, setCreateDepartmentOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "unit" | "department"
    id: string
    name: string
  } | null>(null)
  const [toolbarContainer, setToolbarContainer] =
    useState<HTMLDivElement | null>(null)
  const [directoryMode, setDirectoryMode] =
    useState<ContactDirectoryMode>("organization")
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberLoadError, setMemberLoadError] = useState("")
  const [memberRetry, setMemberRetry] = useState(0)
  const [profileDraft, setProfileDraft] = useState<MemberProfileDraft>({
    name: "",
    email: "",
    phone: "",
    nickname: "",
  })
  const [memberOriginal, setMemberOriginal] = useState<{
    assignments: OrganizationAssignmentInput[]
    reporting: OrganizationReporting
  } | null>(null)
  const [memberSaving, setMemberSaving] = useState(false)
  const [memberSaveError, setMemberSaveError] = useState("")
  const [jobTitleDraft, setJobTitleDraft] = useState("")
  const [treeSearch, setTreeSearch] = useState("")
  const [candidateUsers, setUsers] = useState<AdminUser[]>([])
  const [selectedUsers, setSelectedUsers] = useState<AdminUser[]>([])
  const [userSearch, setUserSearch] = useState("")
  const [userSearchPage, setUserSearchPage] = useState(1)
  const [userSearchTotal, setUserSearchTotal] = useState(0)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [newUnitName, setNewUnitName] = useState("")
  const [newUnitKind, setNewUnitKind] = useState<
    "subsidiary" | "business_unit"
  >("subsidiary")
  const [newUnitParentID, setNewUnitParentID] = useState("")
  const [newDepartmentName, setNewDepartmentName] = useState("")
  const [newDepartmentUnitID, setNewDepartmentUnitID] = useState("")
  const [newDepartmentParentID, setNewDepartmentParentID] = useState("")
  const [unitName, setUnitName] = useState("")
  const [unitParentID, setUnitParentID] = useState("")
  const [unitKind, setUnitKind] = useState<"subsidiary" | "business_unit">(
    "subsidiary"
  )
  const [unitLeaderID, setUnitLeaderID] = useState("")
  const [departmentName, setDepartmentName] = useState("")
  const [departmentUnitID, setDepartmentUnitID] = useState("")
  const [departmentParentID, setDepartmentParentID] = useState("")
  const [leaderIDs, setLeaderIDs] = useState<string[]>([])
  const [primaryLeaderID, setPrimaryLeaderID] = useState("")
  const [editingUserID, setEditingUserID] = useState("")
  const [assignments, setAssignments] = useState<OrganizationAssignmentInput[]>(
    []
  )
  const [reporting, setReporting] = useState<OrganizationReporting>({
    direct_manager_user_id: null,
    dotted_manager_user_ids: [],
  })

  const selectedUserIDs = [
    ...new Set(
      [
        unitLeaderID,
        ...leaderIDs,
        reporting.direct_manager_user_id ?? "",
        ...reporting.dotted_manager_user_ids,
      ].filter(Boolean)
    ),
  ]
    .sort()
    .join(",")
  const users = useMemo(
    () =>
      retainSelectedUsers(
        [...candidateUsers, ...selectedUsers],
        selectedUserIDs.split(",")
      ),
    [candidateUsers, selectedUsers, selectedUserIDs]
  )

  useEffect(() => {
    if (!selectedUserIDs) return
    let alive = true
    const ids = selectedUserIDs.split(",")
    void (async () => {
      const loaded: AdminUser[] = []
      for (let start = 0; start < ids.length; start += 100) {
        const result = await listAdminUsers({
          userIds: ids.slice(start, start + 100),
          pageSize: 100,
        })
        loaded.push(...result.users)
      }
      if (alive) setSelectedUsers(loaded)
    })().catch(() => {
      if (alive)
        toast.error("已选成员资料加载失败，已有选择已保留，请重新打开重试")
    })
    return () => {
      alive = false
    }
  }, [selectedUserIDs, configOpen, editingUserID, reload])

  const refresh = useCallback(() => setReload((value) => value + 1), [])

  useEffect(() => {
    let alive = true
    Promise.all([
      getOrganization(),
      listAdminUsers({ page: 1, pageSize: 1000 }),
      getOrganizationPolicy(),
      getInfoSettings(),
    ])
      .then(([structure, people, settings, info]) => {
        if (!alive) return
        setSnapshot(structure)
        setUsers(people.users)
        setPolicy(settings)
        setDirectoryMode(info.contactDirectoryMode)
        setSelected((current) => {
          const root = structure.units.find((unit) => !unit.parent_id)
          const fallback: Selected | null = root
            ? { kind: "unit", id: root.id }
            : null
          if (!current) return fallback
          const exists =
            current.kind === "unit"
              ? structure.units.some((unit) => unit.id === current.id)
              : structure.departments.some(
                  (department) => department.id === current.id
                )
          return exists ? current : fallback
        })
      })
      .catch((error: unknown) => toast.error(message(error)))
    return () => {
      alive = false
    }
  }, [reload])

  useEffect(() => {
    const keyword = userSearch.trim()
    if (!keyword) return
    let alive = true
    const timer = window.setTimeout(() => {
      void listAdminUsers({ keyword, page: userSearchPage, pageSize: 100 })
        .then((result) => {
          if (!alive) return
          setUserSearchTotal(result.total)
          setUsers((current) => {
            const byID = new Map(current.map((user) => [user.id, user]))
            for (const user of result.users) byID.set(user.id, user)
            return [...byID.values()]
          })
        })
        .catch((error: unknown) => toast.error(message(error)))
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [userSearch, userSearchPage])

  const visibleTree = useMemo(
    () => (snapshot ? filterOrganizationTree(snapshot, "", treeSearch) : null),
    [snapshot, treeSearch]
  )

  const selectedUnit =
    selected?.kind === "unit"
      ? snapshot?.units.find((item) => item.id === selected.id)
      : undefined
  const selectedDepartment =
    selected?.kind === "department"
      ? snapshot?.departments.find((item) => item.id === selected.id)
      : undefined
  const selectedOrganizationLeaders = useMemo(() => {
    if (treeSearch.trim()) return undefined
    if (selectedUnit) {
      return selectedUnit.leader_user_id
        ? [{ user_id: selectedUnit.leader_user_id, is_primary: true }]
        : []
    }
    return selectedDepartment?.leaders
  }, [selectedUnit, selectedDepartment, treeSearch])
  useEffect(() => {
    if (selectedUnit) {
      setUnitName(selectedUnit.name)
      setUnitParentID(selectedUnit.parent_id ?? "")
      setUnitKind(
        selectedUnit.kind === "business_unit" ? "business_unit" : "subsidiary"
      )
      setUnitLeaderID(selectedUnit.leader_user_id ?? "")
    }
    if (selectedDepartment) {
      setDepartmentName(selectedDepartment.name)
      setDepartmentUnitID(selectedDepartment.unit_id)
      setDepartmentParentID(selectedDepartment.parent_id ?? "")
      setLeaderIDs(selectedDepartment.leaders.map((leader) => leader.user_id))
      setPrimaryLeaderID(
        selectedDepartment.leaders.find((leader) => leader.is_primary)
          ?.user_id ?? ""
      )
    }
  }, [selectedUnit, selectedDepartment, configOpen])

  const userName = useCallback(
    (id: string) => users.find((user) => user.id === id)?.name ?? id,
    [users]
  )
  async function run<T>(
    action: () => Promise<T>,
    success: string
  ): Promise<T | undefined> {
    setBusy(true)
    try {
      const result = await action()
      toast.success(success)
      refresh()
      return result
    } catch (error) {
      toast.error(message(error))
      return undefined
    } finally {
      setBusy(false)
    }
  }

  function rootDepartmentID(unitID: string) {
    return (
      snapshot?.departments.find(
        (item) => item.unit_id === unitID && item.is_root
      )?.id ?? ""
    )
  }

  function changeUserSearch(value: string) {
    setUserSearch(value)
    setUserSearchPage(1)
    setUserSearchTotal(0)
  }

  function openCreateUnit(parentUnitID: string) {
    setNewUnitName("")
    setNewUnitKind("subsidiary")
    setNewUnitParentID(parentUnitID)
    setCreateUnitOpen(true)
  }

  function openCreateDepartment(unitID: string, parentDepartmentID: string) {
    setNewDepartmentName("")
    setNewDepartmentUnitID(unitID)
    setNewDepartmentParentID(parentDepartmentID)
    setCreateDepartmentOpen(true)
  }

  async function submitUnit() {
    if (!snapshot || !newUnitName.trim() || !newUnitParentID) return
    const created = await run(
      () =>
        createOrganizationUnit({
          parent_id: newUnitParentID,
          name: newUnitName,
          kind: newUnitKind,
          leader_user_id: null,
          sort_order: 0,
        }),
      "单位已创建"
    )
    if (created) {
      setCreateUnitOpen(false)
      setSelected({ kind: "unit", id: created.id })
    }
  }

  const newDepartmentParent = snapshot?.departments.find(
    (department) => department.id === newDepartmentParentID
  )
  const newDepartmentLocationLabel = newDepartmentParent?.is_root
    ? "所属单位"
    : "所属部门"
  const newDepartmentLocation = snapshot
    ? [
        unitPath(newDepartmentUnitID, snapshot),
        newDepartmentParent && !newDepartmentParent.is_root
          ? departmentPath(newDepartmentParent, snapshot)
          : "",
      ]
        .filter(Boolean)
        .join(" / ")
    : ""

  async function submitDepartment() {
    if (
      !newDepartmentName.trim() ||
      !newDepartmentUnitID ||
      !newDepartmentParentID
    )
      return
    const created = await run(
      () =>
        createOrganizationDepartment({
          unit_id: newDepartmentUnitID,
          parent_id: newDepartmentParentID,
          name: newDepartmentName,
          sort_order: 0,
        }),
      "部门已创建"
    )
    if (created) {
      setCreateDepartmentOpen(false)
      setSelected({ kind: "department", id: created.id })
    }
  }

  const memberDepartmentIDs = useMemo(() => {
    if (!snapshot) return undefined
    if (treeSearch.trim())
      return getSearchedMemberDepartmentIDs(snapshot, treeSearch, true)
    if (selectedUnit?.kind === "group") return undefined
    return getMemberDepartmentIDs(snapshot, selected, true)
  }, [snapshot, selected, selectedUnit, treeSearch])
  const openMember = useCallback((member: Member) => {
    setEditingMember(member)
    setJobTitleDraft(member.jobTitle)
    setProfileDraft({
      name: member.name,
      email: member.email,
      phone: member.phone,
      nickname: member.nickname,
    })
    setMemberOriginal(null)
    setMemberSaveError("")
    setMemberLoading(true)
    setEditingUserID(member.id)
  }, [])

  useEffect(() => {
    if (!editingUserID) return
    let alive = true
    setMemberLoading(true)
    setMemberLoadError("")
    void getOrganizationAssignments(editingUserID)
      .then((value) => {
        if (!alive) return
        const loadedAssignments = value.assignments.map((item) => ({
          department_id: item.department_id,
          is_primary: item.is_primary,
          sort_order: item.sort_order,
        }))
        setAssignments(loadedAssignments)
        setReporting(value.reporting)
        setMemberOriginal({
          assignments: loadedAssignments,
          reporting: value.reporting,
        })
      })
      .catch((error: unknown) => {
        if (alive) setMemberLoadError(message(error))
      })
      .finally(() => {
        if (alive) setMemberLoading(false)
      })
    return () => {
      alive = false
    }
  }, [editingUserID, memberRetry])

  const assignmentsChanged =
    memberOriginal !== null &&
    JSON.stringify(assignments) !== JSON.stringify(memberOriginal.assignments)
  const reportingChanged =
    memberOriginal !== null &&
    JSON.stringify(reporting) !== JSON.stringify(memberOriginal.reporting)
  const profileChanged =
    editingMember !== null &&
    Object.entries(profileDraft).some(
      ([key, value]) => value !== editingMember[key as keyof MemberProfileDraft]
    )
  const jobTitleChanged =
    editingMember !== null && jobTitleDraft !== editingMember.jobTitle
  const memberChanged =
    profileChanged || assignmentsChanged || reportingChanged || jobTitleChanged
  const memberAssignmentsValid =
    !assignmentsChanged ||
    (assignments.length > 0 &&
      assignments.every((item) => item.department_id) &&
      new Set(assignments.map((item) => item.department_id)).size ===
        assignments.length &&
      assignments.filter((item) => item.is_primary).length === 1)

  async function saveMember() {
    if (
      memberSaving ||
      memberLoading ||
      memberLoadError ||
      !memberOriginal ||
      !memberChanged ||
      !memberAssignmentsValid
    )
      return
    setMemberSaving(true)
    setMemberSaveError("")
    try {
      await updateAdminUser(editingUserID, {
        ...profileDraft,
        ...(jobTitleChanged ? { jobTitle: jobTitleDraft } : {}),
        ...(assignmentsChanged ? { assignments } : {}),
        ...(reportingChanged ? { reporting } : {}),
      })
      toast.success("成员信息已保存")
      setEditingUserID("")
      refresh()
    } catch (error) {
      setMemberSaveError(message(error))
    } finally {
      setMemberSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 pt-0 text-sm">
      <div ref={setToolbarContainer} className="shrink-0" />
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(140px,30%)_minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-lg border bg-background p-3">
          {snapshot && visibleTree ? (
            <OrganizationTree
              busy={busy}
              onDelete={(target, name) => {
                if (!busy) setDeleteTarget({ ...target, name })
              }}
              onCreateDepartment={openCreateDepartment}
              onCreateUnit={openCreateUnit}
              onConfigure={(selection) => {
                changeUserSearch("")
                setSelected(selection)
                setConfigOpen(true)
              }}
              onSelect={setSelected}
              search={treeSearch}
              selected={selected}
              snapshot={snapshot}
              visibleTree={visibleTree}
            />
          ) : (
            <p className="px-2 py-3 text-muted-foreground">加载组织架构…</p>
          )}
        </aside>
        <main
          aria-label="成员列表"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          <MembersPage
            organization={snapshot}
            organizationLeaders={selectedOrganizationLeaders}
            defaultDepartmentID={
              selected?.kind === "department"
                ? selected.id
                : rootDepartmentID(selectedUnit?.id ?? "")
            }
            toolbarContainer={toolbarContainer}
            toolbarFilters={
              <Input
                aria-label="搜索单位或部门"
                className="w-44 shrink-0"
                onChange={(event) => setTreeSearch(event.target.value)}
                placeholder="搜索单位或部门"
                value={treeSearch}
              />
            }
            toolbarActions={
              <>
                <Button
                  onClick={() => {
                    setPolicyDraft(policy)
                    setPolicyOpen(true)
                  }}
                  type="button"
                  variant="outline"
                >
                  通讯录设置
                </Button>
              </>
            }
            scopeKey={`${selected?.kind ?? "all"}:${selected?.id ?? ""}:${treeSearch.trim()}`}
            departmentIds={memberDepartmentIDs}
            organizationSearchActive={Boolean(treeSearch.trim())}
            onMembersChanged={refresh}
            onOpenMember={openMember}
            reloadKey={reload}
          />
        </main>
      </div>
      {snapshot && (
        <Dialog
          onOpenChange={(open) => {
            if (!busy) setConfigOpen(open)
          }}
          open={configOpen && Boolean(selectedUnit || selectedDepartment)}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {selectedUnit?.kind === "group"
                  ? "编辑集团"
                  : selectedUnit
                    ? "编辑单位"
                    : "编辑部门"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {!selectedUnit && !selectedDepartment && (
                <p className="text-muted-foreground">
                  {treeSearch.trim()
                    ? "没有匹配的单位或部门"
                    : "请选择单位或部门"}
                </p>
              )}
              {selectedUnit && (
                <section className="space-y-3">
                  {selectedUnit.kind !== "group" && (
                    <h2 className="text-lg font-semibold">
                      {selectedUnit.name}
                    </h2>
                  )}
                  {selectedUnit.kind === "group" ? (
                    <>
                      <div className="space-y-2">
                        <label htmlFor="group-leader" className="block">
                          负责人
                        </label>
                        <Combobox
                          items={users.filter(
                            (user) =>
                              user.status === "active" ||
                              user.id === unitLeaderID ||
                              leaderIDs.includes(user.id) ||
                              user.id === reporting.direct_manager_user_id ||
                              reporting.dotted_manager_user_ids.includes(
                                user.id
                              )
                          )}
                          value={
                            users.find((user) => user.id === unitLeaderID) ??
                            null
                          }
                          itemToStringLabel={(user: AdminUser) =>
                            user.name || user.email
                          }
                          isItemEqualToValue={(a: AdminUser, b: AdminUser) =>
                            a.id === b.id
                          }
                          filter={(user: AdminUser, query: string) =>
                            [user.name, user.email, user.phone].some((text) =>
                              text
                                .toLocaleLowerCase()
                                .includes(query.trim().toLocaleLowerCase())
                            )
                          }
                          onInputValueChange={(query, details) => {
                            if (
                              details.reason === "input-change" ||
                              details.reason === "input-clear"
                            )
                              changeUserSearch(query)
                          }}
                          onValueChange={(user: AdminUser | null) =>
                            setUnitLeaderID(user?.id ?? "")
                          }
                          onOpenChange={(open) => {
                            if (!open) changeUserSearch("")
                          }}
                          disabled={busy}
                        >
                          <ComboboxInput
                            id="group-leader"
                            placeholder="搜索姓名、邮箱或手机号"
                            showClear
                          />
                          <ComboboxContent>
                            <ComboboxEmpty>没有匹配的成员</ComboboxEmpty>
                            <ComboboxList>
                              {(user: AdminUser) => (
                                <ComboboxItem key={user.id} value={user}>
                                  <div className="min-w-0">
                                    <div className="truncate">
                                      {user.name || user.email}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {user.email || user.phone}
                                    </div>
                                  </div>
                                </ComboboxItem>
                              )}
                            </ComboboxList>
                            {userSearch.trim() &&
                              userSearchPage * 100 < userSearchTotal && (
                                <Button
                                  className="w-full"
                                  type="button"
                                  variant="ghost"
                                  onClick={() =>
                                    setUserSearchPage((page) => page + 1)
                                  }
                                >
                                  加载更多
                                </Button>
                              )}
                          </ComboboxContent>
                        </Combobox>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        集团名称可在系统设置中修改。
                      </p>
                      <DialogFooter className="pt-2">
                        <Button
                          disabled={busy}
                          type="button"
                          variant="outline"
                          onClick={() => setConfigOpen(false)}
                        >
                          取消
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={async () => {
                            const saved = await run(
                              () =>
                                setOrganizationUnitLeader(
                                  selectedUnit.id,
                                  unitLeaderID || null
                                ),
                              "集团负责人已保存"
                            )
                            if (saved) setConfigOpen(false)
                          }}
                          type="button"
                        >
                          {busy ? "保存中…" : "保存"}
                        </Button>
                      </DialogFooter>
                    </>
                  ) : (
                    <>
                      <label className="block">
                        单位名称
                        <Input
                          className="mt-1"
                          onChange={(event) => setUnitName(event.target.value)}
                          value={unitName}
                        />
                      </label>
                      <label className="block">
                        单位类型
                        <OrganizationSelect
                          label="单位类型"
                          onChange={(value) =>
                            setUnitKind(value as typeof unitKind)
                          }
                          options={[
                            { value: "subsidiary", label: "子公司" },
                            { value: "business_unit", label: "事业部" },
                          ]}
                          value={unitKind}
                        />
                      </label>
                      <label className="block">
                        上级单位
                        <OrganizationSelect
                          label="上级单位"
                          onChange={setUnitParentID}
                          options={snapshot.units
                            .filter((item) => item.id !== selectedUnit.id)
                            .map((item) => ({
                              value: item.id,
                              label: unitPath(item.id, snapshot),
                            }))}
                          value={unitParentID}
                        />
                      </label>
                      <label className="block">
                        单位负责人
                        <ReportingMemberSelect
                          label="单位负责人"
                          users={users.filter(
                            (user) =>
                              user.status === "active" ||
                              user.id === unitLeaderID
                          )}
                          value={unitLeaderID ? [unitLeaderID] : []}
                          onChange={(ids) => setUnitLeaderID(ids[0] ?? "")}
                          onSearch={changeUserSearch}
                          onLoadMore={
                            userSearch.trim() &&
                            userSearchPage * 100 < userSearchTotal
                              ? () => setUserSearchPage((page) => page + 1)
                              : undefined
                          }
                          disabled={busy}
                        />
                      </label>
                      <DialogFooter className="pt-4">
                        <Button
                          disabled={busy}
                          onClick={() => setConfigOpen(false)}
                          type="button"
                          variant="outline"
                        >
                          取消
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={async () => {
                            const saved = await run(
                              () =>
                                updateOrganizationUnit(selectedUnit.id, {
                                  parent_id: unitParentID,
                                  name: unitName,
                                  kind: unitKind,
                                  leader_user_id: unitLeaderID || null,
                                  sort_order: selectedUnit.sort_order,
                                }),
                              "单位已保存"
                            )
                            if (saved) setConfigOpen(false)
                          }}
                          type="button"
                        >
                          {busy ? "保存中…" : "保存"}
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </section>
              )}
              {selectedDepartment && (
                <fieldset disabled={busy} className="min-w-0 space-y-4">
                  <h2 className="text-lg font-semibold">
                    {departmentPath(selectedDepartment, snapshot)}
                  </h2>
                  {!selectedDepartment.is_root && (
                    <>
                      <label className="block">
                        部门名称
                        <Input
                          className="mt-1"
                          onChange={(event) =>
                            setDepartmentName(event.target.value)
                          }
                          value={departmentName}
                        />
                      </label>
                      <label className="block">
                        所属单位
                        <OrganizationSelect
                          label="所属单位"
                          onChange={(id) => {
                            setDepartmentUnitID(id)
                            setDepartmentParentID(
                              snapshot.departments.find(
                                (item) => item.unit_id === id && item.is_root
                              )?.id ?? ""
                            )
                          }}
                          options={snapshot.units.map((unit) => ({
                            value: unit.id,
                            label: unitPath(unit.id, snapshot),
                          }))}
                          value={departmentUnitID}
                        />
                      </label>
                      <label className="block">
                        上级部门
                        <OrganizationSelect
                          label="上级部门"
                          onChange={setDepartmentParentID}
                          options={snapshot.departments
                            .filter(
                              (item) =>
                                item.unit_id === departmentUnitID &&
                                item.id !== selectedDepartment.id
                            )
                            .map((item) => ({
                              value: item.id,
                              label: item.is_root
                                ? "无上级部门"
                                : departmentPath(item, snapshot),
                            }))}
                          value={departmentParentID}
                        />
                      </label>
                    </>
                  )}
                  <div className="space-y-2 border-t pt-4">
                    <h3 className="font-medium">部门负责人</h3>
                    <label className="block">
                      负责人（可多选）
                      <ReportingMemberSelect
                        label="负责人（可多选）"
                        multiple
                        users={users.filter(
                          (user) =>
                            user.status === "active" ||
                            leaderIDs.includes(user.id)
                        )}
                        value={leaderIDs}
                        onChange={(ids) => {
                          setLeaderIDs(ids)
                          if (!ids.includes(primaryLeaderID))
                            setPrimaryLeaderID(ids[0] ?? "")
                        }}
                        onSearch={changeUserSearch}
                        onLoadMore={
                          userSearch.trim() &&
                          userSearchPage * 100 < userSearchTotal
                            ? () => setUserSearchPage((page) => page + 1)
                            : undefined
                        }
                        disabled={busy}
                      />
                    </label>
                    {leaderIDs.length > 1 && (
                      <label className="block">
                        主负责人
                        <OrganizationSelect
                          label="主负责人"
                          onChange={setPrimaryLeaderID}
                          options={leaderIDs.map((id) => ({
                            value: id,
                            label: userName(id),
                          }))}
                          value={primaryLeaderID}
                        />
                      </label>
                    )}
                    <DialogFooter className="pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfigOpen(false)}
                      >
                        取消
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          (!selectedDepartment.is_root &&
                            (!departmentName.trim() ||
                              !departmentUnitID ||
                              !departmentParentID)) ||
                          (leaderIDs.length > 1 && !primaryLeaderID)
                        }
                        onClick={async () => {
                          const leaders = leaderIDs.map((id) => ({
                            user_id: id,
                            is_primary:
                              leaderIDs.length === 1 || id === primaryLeaderID,
                          }))
                          const saved = await run(
                            () =>
                              selectedDepartment.is_root
                                ? setOrganizationDepartmentLeaders(
                                    selectedDepartment.id,
                                    leaders
                                  )
                                : updateOrganizationDepartment(
                                    selectedDepartment.id,
                                    {
                                      unit_id: departmentUnitID,
                                      parent_id: departmentParentID,
                                      name: departmentName,
                                      sort_order: selectedDepartment.sort_order,
                                      leaders,
                                    }
                                  ),
                            "部门已保存"
                          )
                          if (saved) setConfigOpen(false)
                        }}
                        type="button"
                      >
                        {busy ? "保存中…" : "保存"}
                      </Button>
                    </DialogFooter>
                  </div>
                </fieldset>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!busy && !open) setDeleteTarget(null)
        }}
        open={Boolean(deleteTarget)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定删除{deleteTarget?.kind === "unit" ? "单位" : "部门"}“
            {deleteTarget?.name}”？此操作不可撤销。
            {deleteTarget?.kind === "unit"
              ? "单位中不能有子单位、部门或成员。"
              : "部门中不能有成员或子部门。"}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy || !deleteTarget}
              onClick={async () => {
                if (!deleteTarget) return
                const target = deleteTarget
                const label = target.kind === "unit" ? "单位" : "部门"
                const saved = await run(
                  () =>
                    target.kind === "unit"
                      ? deleteOrganizationUnit(target.id)
                      : deleteOrganizationDepartment(target.id),
                  `${label}已删除`
                )
                if (saved) setDeleteTarget(null)
              }}
            >
              {busy ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={setPolicyOpen} open={policyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>通讯录设置</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {directoryMode === "friends" && (
              <p className="text-muted-foreground">
                当前为好友模式，组织架构不向客户端展示。
              </p>
            )}
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                设置用户侧通讯录的可见范围。
              </p>
              <label className="block">用户可见范围</label>
              <OrganizationSelect
                label="用户可见范围"
                onChange={(value) =>
                  setPolicyDraft((current) => ({
                    ...current,
                    visibility_scope:
                      value as OrganizationPolicy["visibility_scope"],
                  }))
                }
                options={[
                  { value: "all", label: "全组织" },
                  { value: "same_unit", label: "仅主单位" },
                  { value: "same_department", label: "仅所属部门" },
                ]}
                value={policyDraft.visibility_scope}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setPolicyOpen(false)}
              type="button"
              variant="outline"
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  const saved = await run(
                    () => setOrganizationPolicy(policyDraft),
                    "通讯录设置已保存"
                  )
                  if (saved) {
                    setPolicy(saved)
                    setPolicyOpen(false)
                  }
                })()
              }
              type="button"
            >
              保存设置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {snapshot && (
        <Dialog onOpenChange={setCreateUnitOpen} open={createUnitOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建子单位</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1" aria-label="所属单位">
                <p className="text-sm text-muted-foreground">所属单位</p>
                <p className="text-sm">{unitPath(newUnitParentID, snapshot)}</p>
              </div>
              <label className="block">
                单位名称
                <Input
                  autoFocus
                  className="mt-1"
                  onChange={(event) => setNewUnitName(event.target.value)}
                  placeholder="输入单位名称"
                  value={newUnitName}
                />
              </label>
              <div>
                <label className="block">单位类型</label>
                <OrganizationSelect
                  label="单位类型"
                  onChange={(value) =>
                    setNewUnitKind(value as typeof newUnitKind)
                  }
                  options={[
                    { value: "subsidiary", label: "子公司" },
                    { value: "business_unit", label: "事业部" },
                  ]}
                  value={newUnitKind}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setCreateUnitOpen(false)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button
                disabled={busy || !newUnitName.trim() || !newUnitParentID}
                onClick={() => void submitUnit()}
                type="button"
              >
                创建单位
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {snapshot && (
        <Dialog
          onOpenChange={setCreateDepartmentOpen}
          open={createDepartmentOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建子部门</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div
                className="space-y-1"
                aria-label={newDepartmentLocationLabel}
              >
                <p className="text-sm text-muted-foreground">
                  {newDepartmentLocationLabel}
                </p>
                <p className="text-sm">{newDepartmentLocation}</p>
              </div>
              <label className="block">
                部门名称
                <Input
                  autoFocus
                  className="mt-1"
                  onChange={(event) => setNewDepartmentName(event.target.value)}
                  placeholder="输入部门名称"
                  value={newDepartmentName}
                />
              </label>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setCreateDepartmentOpen(false)}
                type="button"
                variant="outline"
              >
                取消
              </Button>
              <Button
                disabled={
                  busy || !newDepartmentName.trim() || !newDepartmentParentID
                }
                onClick={() => void submitDepartment()}
                type="button"
              >
                创建部门
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!open && !memberSaving) setEditingUserID("")
        }}
        open={Boolean(editingUserID)}
      >
        <DialogContent
          className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl"
          showCloseButton={!memberSaving}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>编辑成员</DialogTitle>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void saveMember()
            }}
          >
            <div className="min-h-0 overflow-y-auto overscroll-contain pr-2">
              <fieldset disabled={memberSaving} className="min-w-0 space-y-5">
                {editingMember && (
                  <MemberProfileFields
                    member={editingMember}
                    draft={profileDraft}
                    onChange={setProfileDraft}
                  />
                )}
                <label className="block">
                  职务
                  <MemberJobTitleInput
                    id="edit-member-job-title"
                    disabled={memberSaving}
                    onChange={setJobTitleDraft}
                    value={jobTitleDraft}
                  />
                </label>
                <h2 className="border-t pt-4 text-base font-medium">
                  组织关系
                </h2>
                {memberLoading ? (
                  <p className="text-muted-foreground">加载中…</p>
                ) : memberLoadError ? (
                  <div role="alert" className="space-y-2">
                    <p>{memberLoadError}</p>
                    <Button
                      onClick={() => setMemberRetry((value) => value + 1)}
                      variant="outline"
                    >
                      重试
                    </Button>
                  </div>
                ) : (
                  snapshot && (
                    <>
                      <div className="space-y-3 rounded border p-3">
                        <h3 className="font-medium">汇报关系</h3>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label>
                            直属上级
                            <ReportingMemberSelect
                              label="直属上级"
                              users={users.filter(
                                (user) =>
                                  (user.status === "active" ||
                                    user.id === unitLeaderID ||
                                    leaderIDs.includes(user.id) ||
                                    user.id ===
                                      reporting.direct_manager_user_id ||
                                    reporting.dotted_manager_user_ids.includes(
                                      user.id
                                    )) &&
                                  user.id !== editingUserID
                              )}
                              value={
                                reporting.direct_manager_user_id
                                  ? [reporting.direct_manager_user_id]
                                  : []
                              }
                              onChange={(ids) =>
                                setReporting((current) => ({
                                  ...current,
                                  direct_manager_user_id: ids[0] ?? null,
                                  dotted_manager_user_ids:
                                    current.dotted_manager_user_ids.filter(
                                      (id) => id !== ids[0]
                                    ),
                                }))
                              }
                              onSearch={changeUserSearch}
                              onLoadMore={
                                userSearch.trim() &&
                                userSearchPage * 100 < userSearchTotal
                                  ? () => setUserSearchPage((page) => page + 1)
                                  : undefined
                              }
                              disabled={memberSaving}
                            />
                          </label>
                          <label>
                            虚线上级
                            <ReportingMemberSelect
                              label="虚线上级"
                              multiple
                              users={users.filter(
                                (user) =>
                                  (user.status === "active" ||
                                    user.id === unitLeaderID ||
                                    leaderIDs.includes(user.id) ||
                                    user.id ===
                                      reporting.direct_manager_user_id ||
                                    reporting.dotted_manager_user_ids.includes(
                                      user.id
                                    )) &&
                                  user.id !== editingUserID &&
                                  user.id !== reporting.direct_manager_user_id
                              )}
                              value={reporting.dotted_manager_user_ids}
                              onChange={(ids) =>
                                setReporting((current) => ({
                                  ...current,
                                  dotted_manager_user_ids: ids,
                                }))
                              }
                              onSearch={changeUserSearch}
                              onLoadMore={
                                userSearch.trim() &&
                                userSearchPage * 100 < userSearchTotal
                                  ? () => setUserSearchPage((page) => page + 1)
                                  : undefined
                              }
                              disabled={memberSaving}
                            />
                          </label>
                        </div>
                      </div>
                      <MemberOrganizationMemberships
                        organization={snapshot}
                        value={assignments}
                        onChange={setAssignments}
                        disabled={memberSaving}
                      />
                    </>
                  )
                )}
              </fieldset>
            </div>
            {memberSaveError && (
              <p role="alert" className="text-sm text-destructive">
                {memberSaveError}
              </p>
            )}
            {!memberAssignmentsValid && (
              <p role="alert" className="text-sm text-destructive">
                请选择不重复的组织归属，并设置一个默认组织。
              </p>
            )}
            <DialogFooter className="shrink-0 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={memberSaving}
                onClick={() => setEditingUserID("")}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  memberSaving ||
                  memberLoading ||
                  Boolean(memberLoadError) ||
                  !memberOriginal ||
                  !memberChanged ||
                  !memberAssignmentsValid
                }
              >
                {memberSaving ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
