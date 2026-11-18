import type {
  OrganizationDepartment,
  OrganizationSnapshot,
} from "@/lib/admin-organization"

export function departmentPath(
  department: OrganizationDepartment,
  snapshot: OrganizationSnapshot
) {
  const names: string[] = []
  const seen = new Set<string>()
  let current: OrganizationDepartment | undefined = department
  while (current && !current.is_root && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.name) names.unshift(current.name)
    current = snapshot.departments.find(
      (item) => item.id === current?.parent_id
    )
  }
  return names.join(" / ")
}

export function unitPath(id: string, snapshot: OrganizationSnapshot) {
  const names: string[] = []
  const seen = new Set<string>()
  let currentID: string | null = id
  while (currentID && !seen.has(currentID)) {
    seen.add(currentID)
    const unit = snapshot.units.find((item) => item.id === currentID)
    if (!unit) break
    if (unit.name) names.unshift(unit.name)
    currentID = unit.parent_id
  }
  return names.join(" / ")
}
