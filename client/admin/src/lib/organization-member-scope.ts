import type { OrganizationSnapshot } from "@/lib/admin-organization"

export type OrganizationSelection = { kind: "unit" | "department"; id: string }

export function getSearchedMemberDepartmentIDs(
  snapshot: OrganizationSnapshot,
  search: string,
  includeChildren: boolean
): string[] | undefined {
  const keyword = search.trim().toLocaleLowerCase()
  if (!keyword) return undefined
  const selections: OrganizationSelection[] = [
    ...snapshot.units
      .filter((unit) => unit.name.toLocaleLowerCase().includes(keyword))
      .map((unit) => ({ kind: "unit" as const, id: unit.id })),
    ...snapshot.departments
      .filter(
        (department) =>
          !department.is_root &&
          department.name.toLocaleLowerCase().includes(keyword)
      )
      .map((department) => ({
        kind: "department" as const,
        id: department.id,
      })),
  ]
  return [
    ...new Set(
      selections.flatMap(
        (selection) =>
          getMemberDepartmentIDs(snapshot, selection, includeChildren) ?? []
      )
    ),
  ]
}

// Resolve the selected subtree before requesting a server-paginated member list.
export function getMemberDepartmentIDs(
  snapshot: OrganizationSnapshot,
  selection: OrganizationSelection | null,
  includeChildren: boolean
): string[] | undefined {
  if (!selection) return undefined

  if (selection.kind === "department") {
    const ids = new Set([selection.id])
    if (includeChildren) {
      let changed = true
      while (changed) {
        changed = false
        for (const department of snapshot.departments) {
          if (
            department.parent_id &&
            ids.has(department.parent_id) &&
            !ids.has(department.id)
          ) {
            ids.add(department.id)
            changed = true
          }
        }
      }
    }
    return [...ids]
  }

  const units = new Set([selection.id])
  if (includeChildren) {
    let changed = true
    while (changed) {
      changed = false
      for (const unit of snapshot.units) {
        if (
          unit.parent_id &&
          units.has(unit.parent_id) &&
          !units.has(unit.id)
        ) {
          units.add(unit.id)
          changed = true
        }
      }
    }
  }
  return snapshot.departments
    .filter(
      (department) =>
        units.has(department.unit_id) && (includeChildren || department.is_root)
    )
    .map((department) => department.id)
}
