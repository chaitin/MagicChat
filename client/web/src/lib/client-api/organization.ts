import type { ClientDataFetch } from "./types"

export type ClientOrganizationUnit = {
  member_count?: number
  id: string
  parent_id: string | null
  name: string
  kind: "group" | "subsidiary" | "business_unit"
}

export type ClientOrganizationDepartment = {
  member_count?: number
  id: string
  unit_id: string
  parent_id: string | null
  name: string
  is_root: boolean
  leaders: { user_id: string; is_primary: boolean }[]
}

export type ClientOrganizationSnapshot = {
  units: ClientOrganizationUnit[]
  departments: ClientOrganizationDepartment[]
}

export type ClientOrganizationAssignment = {
  id: string
  user_id: string
  unit_id: string
  department_id: string
  title: string
  is_primary: boolean
}

export type ClientOrganizationReporting = {
  direct_manager_user_id: string | null
  dotted_manager_user_ids: string[]
}

export type ClientOrganizationMember = {
  id: string
  name: string
  nickname: string
  avatar: string
  title: string
  is_primary: boolean
}

async function readOrganization<T>(
  path: string,
  fetcher: ClientDataFetch
): Promise<T> {
  const response = await fetcher(`/api/client/organization${path}`, {
    credentials: "include",
  })
  const payload = (await response.json()) as {
    success?: boolean
    data?: T
    error?: { message?: string }
  }
  if (!response.ok || payload.success === false || payload.data === undefined) {
    throw new Error(payload.error?.message ?? "加载组织架构失败")
  }
  return payload.data
}

export const getClientOrganization = (fetcher: ClientDataFetch = fetch) =>
  readOrganization<ClientOrganizationSnapshot>("", fetcher)

export const getClientOrganizationMembers = (
  departmentID: string,
  page = 1,
  fetcher: ClientDataFetch = fetch,
  includeDescendants = false
) =>
  readOrganization<{
    members: ClientOrganizationMember[]
    total: number
    page_size: number
  }>(
    `/departments/${encodeURIComponent(departmentID)}/members?page=${page}&page_size=100${includeDescendants ? "&include_descendants=true" : ""}`,
    fetcher
  )

export const getClientOrganizationAssignments = (
  userID: string,
  fetcher: ClientDataFetch = fetch
) =>
  readOrganization<{
    assignments: ClientOrganizationAssignment[]
    reporting: ClientOrganizationReporting
  }>(`/users/${encodeURIComponent(userID)}/assignments`, fetcher)
