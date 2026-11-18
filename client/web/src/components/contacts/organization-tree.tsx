import { useState, type ReactNode } from "react"
import { ChevronRight, Building2, Folder } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { ClientOrganizationSnapshot } from "@/lib/client-api/organization"
import { cn } from "@/lib/utils"

export function OrganizationTree({
  snapshot,
  selectedDepartmentId,
  onSelect,
  keyword = "",
  membersContent,
}: {
  snapshot: ClientOrganizationSnapshot
  selectedDepartmentId: string | null
  onSelect: (id: string | null) => void
  keyword?: string
  membersContent?: (departmentId: string) => ReactNode
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [memberNodes, setMemberNodes] = useState<Set<string>>(
    () => new Set(selectedDepartmentId ? [selectedDepartmentId] : [])
  )
  const setOpen = (key: string, open: boolean) =>
    setClosed((current) => ({ ...current, [key]: !open }))
  const selectNode = (key: string, id: string) => {
    setOpen(key, true)
    setMemberNodes(
      (current) =>
        new Set([
          ...current,
          ...(selectedDepartmentId ? [selectedDepartmentId] : []),
          id,
        ])
    )
    onSelect(id)
  }
  const changeNodeOpen = (
    key: string,
    id: string | undefined,
    open: boolean
  ) => {
    if (id && open) {
      selectNode(key, id)
    } else {
      setOpen(key, open)
    }
  }
  const query = keyword.trim().toLocaleLowerCase()
  const units = new Map(snapshot.units.map((item) => [item.id, item]))
  const departments = new Map(
    snapshot.departments.map((item) => [item.id, item])
  )
  const selectedPath = new Set<string>()
  let selectedParent = selectedDepartmentId
    ? departments.get(selectedDepartmentId)
    : undefined
  while (selectedParent && !selectedPath.has(selectedParent.id)) {
    selectedPath.add(selectedParent.id)
    selectedParent = selectedParent.parent_id
      ? departments.get(selectedParent.parent_id)
      : undefined
  }
  const selectedUnitPath = new Set<string>()
  let selectedUnit = selectedDepartmentId
    ? units.get(departments.get(selectedDepartmentId)?.unit_id ?? "")
    : undefined
  while (selectedUnit && !selectedUnitPath.has(selectedUnit.id)) {
    selectedUnitPath.add(selectedUnit.id)
    selectedUnit = selectedUnit.parent_id
      ? units.get(selectedUnit.parent_id)
      : undefined
  }
  const visibleUnits = new Set<string>()
  const visibleDepartments = new Set<string>()
  for (const unit of snapshot.units)
    if (!query || unit.name.toLocaleLowerCase().includes(query)) {
      visibleUnits.add(unit.id)
      for (const department of snapshot.departments)
        if (department.unit_id === unit.id)
          visibleDepartments.add(department.id)
    }
  for (const department of snapshot.departments)
    if (!query || department.name.toLocaleLowerCase().includes(query))
      visibleDepartments.add(department.id)
  for (const id of [...visibleDepartments]) {
    let current = departments.get(id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      visibleDepartments.add(current.id)
      visibleUnits.add(current.unit_id)
      current = current.parent_id
        ? departments.get(current.parent_id)
        : undefined
    }
  }
  for (const id of [...visibleUnits]) {
    let current = units.get(id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      visibleUnits.add(current.id)
      current = current.parent_id ? units.get(current.parent_id) : undefined
    }
  }
  const row = (id: string | null) =>
    cn(
      "group flex h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      id !== null && selectedDepartmentId === id && "font-medium"
    )
  const renderDepartment = (
    id: string,
    ancestors: Set<string>
  ): React.ReactNode => {
    const department = departments.get(id)
    if (!department || ancestors.has(id) || !visibleDepartments.has(id))
      return null
    const children = snapshot.departments.filter(
      (item) =>
        item.parent_id === id &&
        item.unit_id === department.unit_id &&
        !item.is_root &&
        visibleDepartments.has(item.id)
    )
    const next = new Set(ancestors).add(id)
    const showMembers =
      !!membersContent && (selectedDepartmentId === id || memberNodes.has(id))
    return (
      <Collapsible
        className="space-y-1"
        key={id}
        open={
          query ? true : !(closed[`department:${id}`] ?? !selectedPath.has(id))
        }
        onOpenChange={(open) => changeNodeOpen(`department:${id}`, id, open)}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-pressed={selectedDepartmentId === id}
            className={row(id)}
          >
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
            />
            <Folder className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{department.name}</span>
            {typeof department.member_count === "number" && (
              <span
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
                title="含下级，按可见员工去重"
              >
                ({department.member_count})
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {(children.length > 0 || showMembers) && (
          <CollapsibleContent className="ml-4 space-y-1 border-l border-border/50 pl-1">
            {showMembers && <div className="pl-7">{membersContent?.(id)}</div>}
            {children.map((child) => renderDepartment(child.id, next))}
          </CollapsibleContent>
        )}
      </Collapsible>
    )
  }
  const renderUnit = (id: string, ancestors: Set<string>): React.ReactNode => {
    const unit = units.get(id)
    if (!unit || ancestors.has(id) || !visibleUnits.has(id)) return null
    const next = new Set(ancestors).add(id)
    const root = snapshot.departments.find(
      (item) => item.unit_id === id && item.is_root
    )
    const childUnits = snapshot.units.filter(
      (item) => item.parent_id === id && visibleUnits.has(item.id)
    )
    const childDepartments = snapshot.departments.filter(
      (item) =>
        item.unit_id === id &&
        !item.is_root &&
        (!item.parent_id ||
          !departments.has(item.parent_id) ||
          departments.get(item.parent_id)?.is_root) &&
        visibleDepartments.has(item.id)
    )
    const showMembers =
      !!root &&
      !!membersContent &&
      (selectedDepartmentId === root.id || memberNodes.has(root.id))
    const hasChildren =
      childUnits.length > 0 || childDepartments.length > 0 || showMembers
    return (
      <Collapsible
        className="space-y-1"
        key={id}
        open={
          query
            ? true
            : !(
                closed[`unit:${id}`] ??
                !(unit.kind === "group" || selectedUnitPath.has(id))
              )
        }
        onOpenChange={(open) => changeNodeOpen(`unit:${id}`, root?.id, open)}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-pressed={!!root && selectedDepartmentId === root.id}
            className={row(root?.id ?? null)}
          >
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90"
            />
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{unit.name}</span>
            {typeof unit.member_count === "number" && (
              <span
                className="shrink-0 text-xs text-muted-foreground tabular-nums"
                title="含下级，按可见员工去重"
              >
                ({unit.member_count})
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {hasChildren && (
          <CollapsibleContent className="ml-4 space-y-1 border-l border-border/50 pl-1">
            {showMembers && root && (
              <div className="pl-7">{membersContent?.(root.id)}</div>
            )}
            {childDepartments.map((department) =>
              renderDepartment(department.id, new Set())
            )}
            {childUnits.map((child) => renderUnit(child.id, next))}
          </CollapsibleContent>
        )}
      </Collapsible>
    )
  }
  return (
    <nav
      aria-label="组织架构"
      className="mx-3 space-y-1 rounded-md border border-border bg-card p-1"
    >
      {snapshot.units
        .filter((unit) => !unit.parent_id || !units.has(unit.parent_id))
        .map((unit) => renderUnit(unit.id, new Set()))}
      {query && visibleUnits.size === 0 && (
        <p className="px-2 py-4 text-sm text-muted-foreground">
          没有匹配的组织
        </p>
      )}
    </nav>
  )
}
