import { PlusIcon, StarIcon, XIcon } from "lucide-react"

import { MemberOrganizationFields } from "@/components/member-organization-fields"
import { Button } from "@/components/ui/button"
import { departmentPath, unitPath } from "@/lib/organization-paths"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  OrganizationAssignmentInput,
  OrganizationSnapshot,
} from "@/lib/admin-organization"

export function MemberOrganizationMemberships({
  organization,
  value,
  onChange,
  disabled = false,
  fixedDepartmentID,
  fixedUnitID,
}: {
  organization: OrganizationSnapshot
  value: OrganizationAssignmentInput[]
  onChange: (value: OrganizationAssignmentInput[]) => void
  disabled?: boolean
  fixedDepartmentID?: string
  fixedUnitID?: string
}) {
  const hasMultiple = value.length > 1
  const fixedDepartment = organization.departments.find(
    (department) => department.id === fixedDepartmentID
  )
  const fixedLocation = fixedDepartment
    ? [
        unitPath(fixedDepartment.unit_id, organization),
        departmentPath(fixedDepartment, organization),
      ]
        .filter(Boolean)
        .join(" / ")
    : ""
  const hasAvailableDepartment = organization.departments.some(
    (department) =>
      organization.units.some(
        (unit) => unit.id === department.unit_id && !unit.disabled_at
      ) && !value.some((item) => item.department_id === department.id)
  )

  return (
    <div className="space-y-3">
      <h3 className="font-medium">组织归属</h3>
      <div className="space-y-2">
        {value.map((item, index) => (
          <div className="flex flex-wrap items-center gap-2" key={index}>
            <div className="grid min-w-0 flex-1 basis-64 grid-cols-2 gap-2">
              {index === 0 && fixedDepartment ? (
                <p
                  className="col-span-2 flex min-h-9 items-center text-sm"
                  aria-label="当前组织归属"
                >
                  {fixedLocation}
                </p>
              ) : (
                <MemberOrganizationFields
                  organization={organization}
                  departmentID={item.department_id}
                  excludedDepartmentIDs={value
                    .filter((_, position) => position !== index)
                    .map((entry) => entry.department_id)}
                  onChange={(departmentID) =>
                    onChange(
                      value.map((entry, position) =>
                        position === index
                          ? { ...entry, department_id: departmentID }
                          : entry
                      )
                    )
                  }
                  compact
                  fixedUnitID={index === 0 ? fixedUnitID : undefined}
                  disabled={disabled}
                />
              )}
            </div>
            {hasMultiple && (
              <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={
                          item.is_primary
                            ? `第 ${index + 1} 条为默认组织`
                            : `将第 ${index + 1} 条设为默认组织`
                        }
                        aria-pressed={item.is_primary}
                        className="text-muted-foreground aria-pressed:text-foreground"
                        disabled={disabled || !item.department_id}
                        onClick={() => {
                          if (item.is_primary) return
                          onChange(
                            value.map((entry, position) => ({
                              ...entry,
                              is_primary: position === index,
                            }))
                          )
                        }}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <StarIcon
                      aria-hidden="true"
                      className={
                        item.is_primary ? "size-3.5 fill-current" : "size-3.5"
                      }
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {item.is_primary ? "默认组织" : "设为默认"}
                  </TooltipContent>
                </Tooltip>
                {!(index === 0 && (fixedDepartmentID || fixedUnitID)) && (
                  <Button
                    aria-label={`移除第 ${index + 1} 条组织归属`}
                    title="移除此归属"
                    disabled={disabled}
                    onClick={() => {
                      const remaining = value.filter(
                        (_, position) => position !== index
                      )
                      onChange(
                        item.is_primary
                          ? remaining.map((entry, position) => ({
                              ...entry,
                              is_primary: position === 0,
                            }))
                          : remaining
                      )
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <Button
        className="-ml-2"
        disabled={
          disabled ||
          !hasAvailableDepartment ||
          value.length >= 20 ||
          value.some((item) => !item.department_id)
        }
        onClick={() =>
          onChange([
            ...value,
            {
              department_id: "",
              is_primary: value.length === 0,
              sort_order: value.length,
            },
          ])
        }
        size="sm"
        type="button"
        variant="ghost"
      >
        <PlusIcon data-icon="inline-start" />
        添加组织归属
      </Button>
    </div>
  )
}
