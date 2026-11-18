import { adminFetch } from "@/lib/auth"

export type OrganizationUnit = {
  id: string
  parent_id: string | null
  name: string
  kind: "group" | "subsidiary" | "business_unit"
  leader_user_id: string | null
  sort_order: number
  disabled_at: string | null
}

export type OrganizationLeader = { user_id: string; is_primary: boolean }

export type OrganizationDepartment = {
  id: string
  unit_id: string
  parent_id: string | null
  name: string
  sort_order: number
  is_root: boolean
  leaders: OrganizationLeader[]
}

export type OrganizationSnapshot = {
  units: OrganizationUnit[]
  departments: OrganizationDepartment[]
}

export type OrganizationPolicy = {
  visibility_scope: "all" | "same_unit" | "same_department"
}

export type OrganizationAssignment = {
  id: string
  user_id: string
  unit_id: string
  department_id: string
  title: string
  is_primary: boolean
  sort_order: number
}

export type OrganizationReporting = {
  direct_manager_user_id: string | null
  dotted_manager_user_ids: string[]
}

export type OrganizationAssignmentInput = Omit<
  OrganizationAssignment,
  "id" | "user_id" | "unit_id" | "title"
>

export type OrganizationMember = {
  id: string
  name: string
  nickname: string
  avatar: string
  title: string
  is_primary: boolean
  department_id: string
}

export type OrganizationMemberPage = {
  members: OrganizationMember[]
  total: number
  page: number
  page_size: number
}

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const response = await adminFetch(`/api/admin/organization${path}`, {
    method,
    credentials: "include",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = (await response.json()) as {
    data?: T
    error?: { message?: string }
    success?: boolean
  }
  if (!response.ok || payload.success === false || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "组织架构操作失败")
  }
  return payload.data
}

export const getOrganization = () => request<OrganizationSnapshot>("")
export const getOrganizationPolicy = () =>
  request<OrganizationPolicy>("/policy")
export const setOrganizationPolicy = (policy: OrganizationPolicy) =>
  request<OrganizationPolicy>("/policy", "PUT", policy)
export const setOrganizationUnitLeader = (
  id: string,
  leaderUserID: string | null
) =>
  request<OrganizationSnapshot>(`/units/${id}/leader`, "PUT", {
    leader_user_id: leaderUserID,
  })

export const createOrganizationUnit = (input: {
  parent_id: string
  name: string
  kind: "subsidiary" | "business_unit"
  leader_user_id: string | null
  sort_order: number
}) => request<OrganizationUnit>("/units", "POST", input)

export const updateOrganizationUnit = (
  id: string,
  input: {
    parent_id: string
    name: string
    kind: "subsidiary" | "business_unit"
    leader_user_id: string | null
    sort_order: number
  }
) => request<OrganizationSnapshot>(`/units/${id}`, "PUT", input)

export const deleteOrganizationUnit = (id: string) =>
  request<OrganizationSnapshot>(`/units/${id}`, "DELETE")

export const createOrganizationDepartment = (input: {
  unit_id: string
  parent_id: string
  name: string
  sort_order: number
}) => request<OrganizationDepartment>("/departments", "POST", input)

export const updateOrganizationDepartment = (
  id: string,
  input: {
    unit_id: string
    parent_id: string
    name: string
    sort_order: number
    leaders?: OrganizationLeader[]
  }
) => request<OrganizationSnapshot>(`/departments/${id}`, "PUT", input)

export const deleteOrganizationDepartment = (id: string) =>
  request<OrganizationSnapshot>(`/departments/${id}`, "DELETE")

export const setOrganizationDepartmentLeaders = (
  id: string,
  leaders: OrganizationLeader[]
) =>
  request<OrganizationSnapshot>(`/departments/${id}/leaders`, "PUT", {
    leaders,
  })

export const getOrganizationMembers = (id: string, page: number) =>
  request<OrganizationMemberPage>(
    `/departments/${id}/members?page=${page}&page_size=50`
  )

export const getOrganizationAssignments = (id: string) =>
  request<{
    assignments: OrganizationAssignment[]
    reporting: OrganizationReporting
  }>(`/users/${id}/assignments`)

export const setOrganizationAssignments = (
  id: string,
  assignments: OrganizationAssignmentInput[]
) =>
  request<{ assignments: OrganizationAssignment[] }>(
    `/users/${id}/assignments`,
    "PUT",
    { assignments }
  )

export const setOrganizationReporting = (
  id: string,
  reporting: OrganizationReporting
) => request<OrganizationReporting>(`/users/${id}/reporting`, "PUT", reporting)
