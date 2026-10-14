import { useMemo, useState } from "react"
import type { ProjectTaskAssignee } from "../../../shared/account-data"
import {
  createUserSearchIndex,
  matchesUserSearch,
  type UserSearchIndex,
} from "../../../shared/user-search"
import { EntityAvatar } from "@/components/avatar/entity-avatar"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox"
import { cn } from "@/lib/utils"

export function TaskAssigneePicker({
  targetId,
  members,
  value,
  name,
  theme,
  disabled = false,
  emptyLabel = "未分配",
  ariaLabel = "负责人",
  className,
  contentClassName,
  onChange,
}: {
  targetId: string
  members: ProjectTaskAssignee[]
  value: string
  name: string
  theme: "light" | "dark"
  disabled?: boolean
  emptyLabel?: string
  ariaLabel?: string
  className?: string
  contentClassName?: string
  onChange: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const options = useMemo(() => {
    const createOption = (
      id: string,
      label: string,
      fields: Parameters<typeof createUserSearchIndex>[0],
    ) => ({ id, name: label, searchIndex: createUserSearchIndex(fields) })
    const items = [
      createOption("", emptyLabel, {
        displayName: emptyLabel,
        name: "",
        nickname: "",
        email: "",
        phone: "",
      }),
      ...members
        .filter((member) => member.status === "active")
        .map((member) => createOption(member.id, member.displayName, member)),
    ]
    if (value && !items.some((option) => option.id === value)) {
      items.splice(
        1,
        0,
        createOption(value, name, { displayName: name, name, nickname: "", email: "", phone: "" }),
      )
    }
    return items
  }, [members, value, name, emptyLabel])

  return (
    <Combobox
      items={options}
      filter={(option: { searchIndex: UserSearchIndex }, input) =>
        matchesUserSearch(option.searchIndex, input)
      }
      value={options.find((option) => option.id === value)}
      onValueChange={(option) => onChange(option?.id ?? "")}
      itemToStringLabel={(option) => option.name}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, selected) => option.id === selected.id}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery("")
      }}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxTrigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-sm font-normal shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
          className,
        )}
      >
        {value ? (
          <TaskAssignee targetId={targetId} userId={value} name={name} theme={theme} />
        ) : (
          <span className="truncate" title={emptyLabel}>
            {emptyLabel}
          </span>
        )}
      </ComboboxTrigger>
      <ComboboxContent className={cn("min-w-(--anchor-width)", contentClassName)}>
        <ComboboxInput placeholder="搜索用户" aria-label="搜索负责人" showTrigger={false} />
        <ComboboxEmpty>未找到匹配的负责人</ComboboxEmpty>
        <ComboboxList>
          {(option: { id: string; name: string }) => (
            <ComboboxItem key={option.id} value={option}>
              {option.id ? (
                <TaskAssignee
                  targetId={targetId}
                  userId={option.id}
                  name={option.name}
                  theme={theme}
                />
              ) : (
                option.name
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function TaskAssignee({
  targetId,
  userId,
  name,
  theme,
}: {
  targetId: string
  userId: string
  name: string
  theme: "light" | "dark"
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <EntityAvatar
        targetId={targetId}
        type="user"
        id={userId}
        theme={theme}
        size={20}
        label={`${name}头像`}
      />
      <span className="truncate">{name}</span>
    </span>
  )
}
