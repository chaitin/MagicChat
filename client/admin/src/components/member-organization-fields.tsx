import { useId } from "react"

import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { OrganizationSnapshot } from "@/lib/admin-organization"

export function MemberOrganizationFields({
  organization,
  departmentID,
  onChange,
  disabled = false,
  compact = false,
  excludedDepartmentIDs = [],
  fixedUnitID,
}: {
  organization: OrganizationSnapshot
  departmentID: string
  onChange: (departmentID: string) => void
  disabled?: boolean
  compact?: boolean
  excludedDepartmentIDs?: string[]
  fixedUnitID?: string
}) {
  const unitInputID = useId()
  const departmentInputID = useId()
  const unitID =
    fixedUnitID ??
    organization.departments.find((item) => item.id === departmentID)?.unit_id
  const departments = organization.departments.filter(
    (item) => item.unit_id === unitID
  )
  const hasDepartments = departments.some((department) => !department.is_root)
  const availableDepartments = organization.departments.filter(
    (item) => !excludedDepartmentIDs.includes(item.id)
  )
  const departmentOptions = departments.map((department) => {
    const names = [department.name]
    let parentID = department.parent_id
    while (parentID) {
      const parent = organization.departments.find(
        (item) => item.id === parentID
      )
      if (!parent || parent.is_root) break
      names.unshift(parent.name)
      parentID = parent.parent_id
    }
    return {
      value: department.id,
      label: department.is_root
        ? hasDepartments
          ? "不指定部门"
          : "无部门"
        : names.join(" / "),
    }
  })

  return (
    <>
      <Field>
        <FieldLabel
          className={compact ? "sr-only" : undefined}
          htmlFor={unitInputID}
        >
          所属单位
        </FieldLabel>
        {fixedUnitID ? (
          <p
            className="flex h-9 items-center truncate text-sm"
            aria-label="所属单位"
          >
            {organization.units.find((unit) => unit.id === fixedUnitID)?.name}
          </p>
        ) : (
          <Select
            disabled={disabled}
            value={unitID ?? ""}
            onValueChange={(value) => {
              if (!value) return
              const choices = availableDepartments.filter(
                (item) => item.unit_id === value
              )
              onChange(
                (choices.find((item) => item.is_root) ?? choices[0])?.id ?? ""
              )
            }}
          >
            <SelectTrigger
              id={unitInputID}
              aria-label="所属单位"
              className="w-full min-w-0"
            >
              <SelectValue>
                {organization.units.find((unit) => unit.id === unitID)?.name ??
                  "请选择单位"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {organization.units
                .filter((unit) => !unit.disabled_at)
                .map((unit) => (
                  <SelectItem
                    key={unit.id}
                    value={unit.id}
                    disabled={
                      !availableDepartments.some(
                        (item) => item.unit_id === unit.id
                      )
                    }
                  >
                    {unit.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field>
        <FieldLabel
          className={compact ? "sr-only" : undefined}
          htmlFor={departmentInputID}
        >
          所属部门
        </FieldLabel>
        <Select
          disabled={disabled || !unitID}
          value={departmentID}
          onValueChange={(value) => onChange(value ?? "")}
        >
          <SelectTrigger
            id={departmentInputID}
            aria-label="所属部门"
            className="w-full min-w-0"
          >
            <SelectValue>
              {departmentOptions.find((option) => option.value === departmentID)
                ?.label ?? "请选择部门"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {departmentOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={excludedDepartmentIDs.includes(option.value)}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}
