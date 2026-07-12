import * as React from "react"

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  useComboboxAnchor,
} from "@/components/ui/combobox"

export function ProjectTaskLabelsCombobox({
  disabled = false,
  loading = false,
  onValueChange,
  options,
  portalContainer,
  value,
}: {
  disabled?: boolean
  loading?: boolean
  onValueChange: (value: string[]) => void
  options: string[]
  portalContainer: React.RefObject<HTMLDivElement | null>
  value: string[]
}) {
  const [highlightedLabel, setHighlightedLabel] = React.useState<
    string | undefined
  >()
  const [query, setQuery] = React.useState("")
  const anchor = useComboboxAnchor()

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      highlightedLabel
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const nextLabel = query.trim()
    if (!nextLabel) {
      return
    }
    const existing = value.some(
      (label) => label.toLocaleLowerCase() === nextLabel.toLocaleLowerCase()
    )
    if (!existing) {
      onValueChange([...value, nextLabel])
    }
    setQuery("")
  }

  return (
    <Combobox<string, true>
      disabled={disabled}
      filter={(label, inputValue) =>
        label
          .toLocaleLowerCase()
          .includes(inputValue.trim().toLocaleLowerCase())
      }
      inputValue={query}
      items={options}
      multiple
      onInputValueChange={(inputValue) => setQuery(String(inputValue))}
      onItemHighlighted={(label) => setHighlightedLabel(label)}
      onValueChange={(labels) => onValueChange(labels)}
      value={value}
    >
      <div ref={anchor}>
        <ComboboxChips>
          {value.map((label) => (
            <ComboboxChip key={label}>{label}</ComboboxChip>
          ))}
          <ComboboxChipsInput
            aria-label="任务标签"
            disabled={disabled}
            onKeyDown={handleInputKeyDown}
            placeholder={value.length > 0 ? "添加标签" : "输入或选择标签"}
          />
        </ComboboxChips>
      </div>
      <ComboboxContent anchor={anchor} container={portalContainer}>
        <ComboboxEmpty>
          {loading ? "正在加载标签" : "暂无候选标签"}
        </ComboboxEmpty>
        <ComboboxList>
          {(label: string) => (
            <ComboboxItem key={label} value={label}>
              {label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
