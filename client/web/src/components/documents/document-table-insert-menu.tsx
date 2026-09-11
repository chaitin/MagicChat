import * as React from "react"
import { Sheet } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const maximumTableRows = 10
const maximumTableColumns = 10

export function DocumentTableInsertMenu({
  disabled = false,
  onInsert,
}: {
  disabled?: boolean
  onInsert: (rows: number, columns: number) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [selection, setSelection] = React.useState({ columns: 3, rows: 3 })
  const cellRefs = React.useRef(new Map<string, HTMLButtonElement>())

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) setSelection({ columns: 3, rows: 3 })
  }

  function insertTable(rows: number, columns: number) {
    onInsert(rows, columns)
    setOpen(false)
  }

  function focusCell(rows: number, columns: number) {
    const nextSelection = {
      columns: Math.min(Math.max(columns, 1), maximumTableColumns),
      rows: Math.min(Math.max(rows, 1), maximumTableRows),
    }
    setSelection(nextSelection)
    requestAnimationFrame(() => {
      cellRefs.current
        .get(tableCellKey(nextSelection.rows, nextSelection.columns))
        ?.focus()
    })
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label="插入表格"
          disabled={disabled}
          size="icon-sm"
          title="插入表格"
          type="button"
          variant="ghost"
        >
          <Sheet />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-auto p-3">
        <div className="mb-2 flex items-center justify-between gap-6 text-xs">
          <span className="font-medium">插入表格</span>
          <span className="text-muted-foreground">
            {selection.rows} × {selection.columns}
          </span>
        </div>
        <div
          aria-label="选择表格行列数量"
          className="grid grid-cols-10 gap-1"
          role="grid"
        >
          {Array.from({ length: maximumTableRows }, (_, rowIndex) =>
            Array.from({ length: maximumTableColumns }, (_, columnIndex) => {
              const rows = rowIndex + 1
              const columns = columnIndex + 1
              const selected =
                rows <= selection.rows && columns <= selection.columns
              const active =
                rows === selection.rows && columns === selection.columns
              const key = tableCellKey(rows, columns)
              return (
                <button
                  aria-label={`${rows} 行 ${columns} 列`}
                  aria-pressed={active}
                  className={cn(
                    "size-5 rounded-sm border transition-colors",
                    selected
                      ? "border-sky-500 bg-sky-100 dark:bg-sky-950"
                      : "border-border bg-background hover:border-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50"
                  )}
                  key={key}
                  onClick={() => insertTable(rows, columns)}
                  onFocus={() => setSelection({ columns, rows })}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") focusCell(rows - 1, columns)
                    else if (event.key === "ArrowDown")
                      focusCell(rows + 1, columns)
                    else if (event.key === "ArrowLeft")
                      focusCell(rows, columns - 1)
                    else if (event.key === "ArrowRight")
                      focusCell(rows, columns + 1)
                    else return
                    event.preventDefault()
                  }}
                  onMouseEnter={() => setSelection({ columns, rows })}
                  ref={(element) => {
                    if (element) cellRefs.current.set(key, element)
                    else cellRefs.current.delete(key)
                  }}
                  role="gridcell"
                  tabIndex={active ? 0 : -1}
                  type="button"
                />
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function tableCellKey(rows: number, columns: number) {
  return `${rows}:${columns}`
}
