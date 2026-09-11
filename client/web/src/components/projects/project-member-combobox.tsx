import * as React from "react"

import { ProjectMemberAvatar } from "@/components/projects/project-member-avatar"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"
import { InputGroupAddon } from "@/components/ui/input-group"
import type { ClientProjectMember } from "@/lib/project-data-api"
import { projectMemberMatchesQuery } from "@/lib/project-members"

export function ProjectMemberCombobox({
  ariaLabel = "任务负责人",
  disabled = false,
  loading = false,
  members,
  onValueChange,
  portalContainer,
  showEmptyEmail = true,
  value,
}: {
  ariaLabel?: string
  disabled?: boolean
  loading?: boolean
  members: ClientProjectMember[]
  onValueChange: (member: ClientProjectMember | null) => void
  portalContainer: React.RefObject<HTMLDivElement | null>
  showEmptyEmail?: boolean
  value: ClientProjectMember | null
}) {
  const anchor = useComboboxAnchor()

  return (
    <Combobox<ClientProjectMember>
      disabled={disabled}
      filter={projectMemberMatchesQuery}
      isItemEqualToValue={(member, selected) => member.id === selected.id}
      itemToStringLabel={(member) => member.displayName}
      itemToStringValue={(member) => member.id}
      items={members}
      onValueChange={onValueChange}
      value={value}
    >
      <div ref={anchor}>
        <ComboboxInput
          aria-label={ariaLabel}
          className="w-full"
          placeholder={loading ? "正在加载" : "未指派"}
          showClear
        >
          {value && (
            <InputGroupAddon align="inline-start">
              <ProjectMemberAvatar member={value} />
            </InputGroupAddon>
          )}
        </ComboboxInput>
      </div>
      <ComboboxContent anchor={anchor} container={portalContainer}>
        <ComboboxEmpty>没有匹配的项目成员</ComboboxEmpty>
        <ComboboxList>
          {(member: ClientProjectMember) => (
            <ComboboxItem key={member.id} value={member}>
              <ProjectMemberAvatar className="size-8" member={member} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{member.displayName}</span>
                {(showEmptyEmail || member.email) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
