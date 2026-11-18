import { useEffect, useState } from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { listJobTitles } from "@/lib/admin-job-titles"

export function MemberJobTitleInput({
  id,
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  readOnly?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const [result, setResult] = useState<{ keyword: string; titles: string[] }>({
    keyword: "",
    titles: [],
  })
  const suggestions = result.keyword === value ? result.titles : []

  useEffect(() => {
    if (!focused || disabled || readOnly) return
    let active = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void listJobTitles(value, controller.signal)
        .then((titles) => {
          if (active) setResult({ keyword: value, titles })
        })
        .catch(() => {
          // Suggestions are optional; lookup failures must not block manual entry.
          if (active) setResult({ keyword: value, titles: [] })
        })
    }, 200)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [focused, value, disabled, readOnly])

  return (
    <Combobox
      items={suggestions}
      inputValue={value}
      onInputValueChange={(next) => {
        if (!disabled && !readOnly) onChange(next)
      }}
      onValueChange={(next) => {
        if (typeof next === "string" && !disabled && !readOnly) onChange(next)
      }}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        aria-label="职务"
        maxLength={160}
        autoComplete="off"
        readOnly={readOnly}
        disabled={disabled}
        showTrigger={false}
        className="w-full"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {suggestions.length > 0 && !readOnly && !disabled && (
        <ComboboxContent>
          <ComboboxList>
            {(title: string) => (
              <ComboboxItem key={title} value={title}>
                {title}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      )}
    </Combobox>
  )
}
