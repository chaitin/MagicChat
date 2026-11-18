import type { AuthenticatedTarget } from "@/core/server-target"
import { createProtectedApiClient } from "@/data/protected-api-client"

export const ORGANIZATION_FALLBACK_INTERVAL_MS = 15 * 60_000

export type MobileOrganizationSnapshot = {
  units: { id: string; parent_id: string | null; name: string; kind: string; member_count?: number }[]
  departments: { id: string; unit_id: string; parent_id: string | null; name: string; is_root: boolean; member_count?: number }[]
}

export type MobileDepartmentMembers = {
  members: { id: string; name: string; nickname: string; avatar: string; title: string; is_primary: boolean }[]
  page: number
  page_size: number
  total: number
}

export type MobileOrganizationAssignment = {
  unit_id: string
  department_id: string
  title: string
  is_primary: boolean
}

export type MobileOrganizationReporting = {
  direct_manager_user_id: string | null
  dotted_manager_user_ids: string[]
}

export function fetchOrganizationSnapshot(target: AuthenticatedTarget) {
  return createProtectedApiClient(target).request<MobileOrganizationSnapshot>(
    "/api/client/organization",
    { method: "GET", errorMessage: "加载组织架构失败" }
  )
}

export function fetchDepartmentMembers(target: AuthenticatedTarget, departmentID: string, page: number) {
  return createProtectedApiClient(target).request<MobileDepartmentMembers>(
    `/api/client/organization/departments/${encodeURIComponent(departmentID)}/members?page=${page}&page_size=100`,
    { method: "GET", errorMessage: "加载部门成员失败" }
  )
}

export function fetchOrganizationAssignments(target: AuthenticatedTarget, userID: string) {
  return createProtectedApiClient(target).request<{ assignments: MobileOrganizationAssignment[]; reporting: MobileOrganizationReporting }>(
    `/api/client/organization/users/${encodeURIComponent(userID)}/assignments`,
    { method: "GET", errorMessage: "加载任职信息失败" }
  )
}
