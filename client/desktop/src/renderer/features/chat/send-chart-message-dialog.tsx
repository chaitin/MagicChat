import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import {
  Delete02Icon,
  DragDropVerticalIcon,
  Loading03Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SendRichMessageBody } from "../../../shared/account-data"
import { cn } from "@/lib/utils"
import { ChartBody } from "./message-bodies/chart-body"

type ChartType = "line" | "bar" | "pie" | "radar"
type SeriesDraft = { name: string; values: string[] }
type NamedValue = { id: string; name: string; value: string }
type LabelDraft = { id: string; label: string }
type AxisDraft = { id: string; name: string; max: string }
type RowKind = "labels" | "axes" | "items"
type ChartDraft = {
  title: string
  description: string
  direction: "horizontal" | "vertical"
  mode: "grouped" | "stacked"
  labels: LabelDraft[]
  axes: AxisDraft[]
  items: NamedValue[]
  series: SeriesDraft[]
}

function newLabel(label = ""): LabelDraft {
  return { id: crypto.randomUUID(), label }
}

function newPieItem(name = "", value = ""): NamedValue {
  return { id: crypto.randomUUID(), name, value }
}

function newAxis(name = "", max = "100"): AxisDraft {
  return { id: crypto.randomUUID(), name, max }
}

function exampleDraft(chartType: ChartType): ChartDraft {
  const base = {
    direction: "vertical" as const,
    mode: "grouped" as const,
    labels: [newLabel("一月"), newLabel("二月"), newLabel("三月")],
    axes: [newAxis("性能"), newAxis("稳定性"), newAxis("体验")],
    items: [newPieItem("桌面端", "45"), newPieItem("移动端", "35"), newPieItem("网页端", "20")],
  }
  switch (chartType) {
    case "line":
      return {
        ...base,
        title: "月度访问趋势",
        description: "单位：千次",
        series: [{ name: "访问量", values: ["12", "20", "16"] }],
      }
    case "bar":
      return {
        ...base,
        title: "季度销量对比",
        description: "单位：件",
        labels: [newLabel("第一季度"), newLabel("第二季度"), newLabel("第三季度")],
        series: [
          { name: "今年", values: ["32", "48", "41"] },
          { name: "去年", values: ["24", "38", "35"] },
        ],
      }
    case "pie":
      return {
        ...base,
        title: "设备类型占比",
        description: "访问设备分布",
        series: [{ name: "访问量", values: ["12", "20", "16"] }],
      }
    case "radar":
      return {
        ...base,
        title: "能力评估",
        description: "满分 100",
        series: [{ name: "当前表现", values: ["72", "88", "65"] }],
      }
  }
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

export function SendChartMessageDialog({
  open,
  conversationName,
  onOpenChange,
  onSend,
}: {
  open: boolean
  conversationName: string
  onOpenChange: (open: boolean) => void
  onSend: (body: SendRichMessageBody) => Promise<void>
}) {
  const chartTypeId = useId()
  const [initialDraft] = useState(() => exampleDraft("line"))
  const savedDrafts = useRef<Partial<Record<ChartType, ChartDraft>>>({})
  const [chartType, setChartType] = useState<ChartType>("line")
  const [title, setTitle] = useState(initialDraft.title)
  const [description, setDescription] = useState(initialDraft.description)
  const [direction, setDirection] = useState<"horizontal" | "vertical">(initialDraft.direction)
  const [mode, setMode] = useState<"grouped" | "stacked">(initialDraft.mode)
  const [labels, setLabels] = useState<LabelDraft[]>(initialDraft.labels)
  const [axes, setAxes] = useState<AxisDraft[]>(initialDraft.axes)
  const [items, setItems] = useState<NamedValue[]>(initialDraft.items)
  const draggedRow = useRef<{ kind: RowKind; id: string } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const [series, setSeries] = useState<SeriesDraft[]>(initialDraft.series)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const dimensions = chartType === "radar" ? axes.length : labels.length
  const labelName = chartType === "bar" && direction === "horizontal" ? "Y 轴标签" : "X 轴标签"

  function applyDraft(draft: ChartDraft) {
    setTitle(draft.title)
    setDescription(draft.description)
    setDirection(draft.direction)
    setMode(draft.mode)
    setLabels(draft.labels)
    setAxes(draft.axes)
    setItems(draft.items)
    setSeries(draft.series)
  }

  function changeChartType(next: ChartType) {
    if (next === chartType) return
    savedDrafts.current[chartType] = {
      title,
      description,
      direction,
      mode,
      labels,
      axes,
      items,
      series,
    }
    applyDraft(savedDrafts.current[next] ?? exampleDraft(next))
    setChartType(next)
    finishRowDrag()
    setError("")
  }

  function reset() {
    savedDrafts.current = {}
    setChartType("line")
    applyDraft(exampleDraft("line"))
    finishRowDrag()
    setError("")
  }

  function updateDimension(kind: "labels" | "axes", add: boolean, index?: number) {
    if (kind === "labels") {
      setLabels((current) =>
        add ? [...current, newLabel()] : current.filter((_, position) => position !== index),
      )
    } else {
      setAxes((current) =>
        add ? [...current, newAxis()] : current.filter((_, position) => position !== index),
      )
    }
    setSeries((current) =>
      current.map((item) => ({
        ...item,
        values: add
          ? [...item.values, ""]
          : item.values.filter((_, position) => position !== index),
      })),
    )
  }

  function moveRow(kind: RowKind, fromId: string, toId: string) {
    const rows = kind === "labels" ? labels : kind === "axes" ? axes : items
    const from = rows.findIndex((row) => row.id === fromId)
    const to = rows.findIndex((row) => row.id === toId)
    if (from < 0 || to < 0 || from === to) return
    if (kind === "items") {
      setItems((current) => moveItem(current, from, to))
      return
    }
    if (kind === "labels") setLabels((current) => moveItem(current, from, to))
    else setAxes((current) => moveItem(current, from, to))
    setSeries((current) =>
      current.map((item) => ({
        ...item,
        values: moveItem(
          Array.from(
            { length: Math.max(rows.length, item.values.length) },
            (_, index) => item.values[index] ?? "",
          ),
          from,
          to,
        ),
      })),
    )
  }

  function startRowDrag(event: DragEvent<HTMLSpanElement>, kind: RowKind, id: string) {
    if (sending) {
      event.preventDefault()
      return
    }
    const row = event.currentTarget.parentElement
    if (row) {
      const bounds = row.getBoundingClientRect()
      event.dataTransfer.setDragImage(row, event.clientX - bounds.left, event.clientY - bounds.top)
    }
    draggedRow.current = { kind, id }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", id)
    setDraggingId(id)
  }

  function finishRowDrag() {
    draggedRow.current = null
    setDraggingId(null)
    setDropTargetId(null)
  }

  function handleRowDragOver(event: DragEvent<HTMLDivElement>, kind: RowKind, id: string) {
    if (draggedRow.current?.kind !== kind || draggedRow.current.id === id) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDropTargetId(id)
  }

  function handleRowDrop(event: DragEvent<HTMLDivElement>, kind: RowKind, id: string) {
    if (draggedRow.current?.kind !== kind) return
    event.preventDefault()
    moveRow(kind, draggedRow.current.id, id)
    finishRowDrag()
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLSpanElement>, kind: RowKind, index: number) {
    if (sending) return
    const rows = kind === "labels" ? labels : kind === "axes" ? axes : items
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1
    if (to < 0 || to >= rows.length) return
    event.preventDefault()
    moveRow(kind, rows[index].id, rows[to].id)
  }

  function parseNumber(value: string, label: string) {
    if (!value.trim()) throw new Error(`请填写${label}`)
    const number = Number(value)
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000_000_000) {
      throw new Error(`${label}必须是有效数值`)
    }
    return number
  }

  function messageBody(): SendRichMessageBody {
    const base = {
      type: "chart" as const,
      chartType,
      title: title.trim(),
      description: description.trim(),
    }
    if (chartType === "pie") {
      const names = items.map((item) => item.name.trim())
      if (names.some((name) => !name) || new Set(names).size !== names.length)
        throw new Error("饼图分类名称不能为空且不能重复")
      const values = items.map((item) => ({
        name: item.name.trim(),
        value: parseNumber(item.value, "饼图数值"),
      }))
      if (values.some((item) => item.value <= 0)) throw new Error("饼图数值必须大于 0")
      return { ...base, data: { items: values } }
    }
    const names = series.map((item) => item.name.trim())
    if (names.some((name) => !name) || new Set(names).size !== names.length)
      throw new Error("系列名称不能为空且不能重复")
    const values = series.map((item) => ({
      name: item.name.trim(),
      values: item.values.slice(0, dimensions).map((value) => parseNumber(value, "系列数值")),
    }))
    if (chartType === "radar") {
      const normalizedAxes = axes.map((axis) => ({
        name: axis.name.trim(),
        max: parseNumber(axis.max, "维度最大值"),
      }))
      const axisNames = normalizedAxes.map((axis) => axis.name)
      if (
        axisNames.some((name) => !name) ||
        new Set(axisNames).size !== axisNames.length ||
        normalizedAxes.some((axis) => axis.max <= 0)
      )
        throw new Error("维度名称不能为空或重复，最大值必须大于 0")
      if (
        values.some((item) =>
          item.values.some((value, index) => value < 0 || value > normalizedAxes[index].max),
        )
      )
        throw new Error("雷达图数值必须在 0 和对应维度最大值之间")
      return { ...base, data: { axes: normalizedAxes, series: values } }
    }
    if (labels.some((label) => !label.label.trim())) throw new Error("请填写全部标签")
    const data = { labels: labels.map((label) => label.label.trim()), series: values }
    return { ...base, data: chartType === "bar" ? { ...data, direction, mode } : data }
  }

  const previewBody = (() => {
    if (!title.trim() || !description.trim()) return null
    try {
      const body = messageBody()
      return body.type === "chart" ? body : null
    } catch {
      return null
    }
  })()

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    try {
      const body = messageBody()
      setError("")
      setSending(true)
      await onSend(body)
      reset()
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "发送图表消息失败")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (sending) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>发送图表消息</DialogTitle>
          <DialogDescription className="sr-only">发送到 {conversationName}</DialogDescription>
        </DialogHeader>
        <form className="grid min-h-0 gap-4" onSubmit={(event) => void submit(event)}>
          <ScrollArea
            type="auto"
            className="-mr-5 -ml-1 min-w-0 max-h-[calc(85vh-11rem)] overflow-hidden"
            viewportClassName="h-auto max-h-[calc(85vh-11rem)] pr-5 pl-1"
          >
            <div className="grid gap-4">
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">图表类型</legend>
                <RadioGroup
                  className="grid-cols-2 gap-2 sm:grid-cols-4"
                  value={chartType}
                  onValueChange={(value) => changeChartType(value as ChartType)}
                >
                  {(
                    [
                      ["line", "折线图"],
                      ["bar", "柱状图"],
                      ["pie", "饼图"],
                      ["radar", "雷达图"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      htmlFor={`${chartTypeId}-${value}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 transition-colors hover:border-foreground/30 hover:bg-muted/50",
                        chartType === value && "border-foreground/40 bg-muted",
                      )}
                    >
                      <RadioGroupItem id={`${chartTypeId}-${value}`} value={value} />
                      <span>{label}</span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>
              <Field label="标题">
                <Input
                  maxLength={16}
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="图表标题"
                />
              </Field>
              <Field label="说明">
                <Input
                  maxLength={128}
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="例如：单位、统计范围"
                />
              </Field>
              {chartType === "bar" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid min-w-0 gap-1.5 text-sm">
                    <label htmlFor={`${chartTypeId}-direction`}>方向</label>
                    <Select
                      value={direction}
                      onValueChange={(value) => setDirection(value as typeof direction)}
                    >
                      <SelectTrigger id={`${chartTypeId}-direction`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="vertical">纵向</SelectItem>
                        <SelectItem value="horizontal">横向</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-0 gap-1.5 text-sm">
                    <label htmlFor={`${chartTypeId}-mode`}>排列方式</label>
                    <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                      <SelectTrigger id={`${chartTypeId}-mode`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="grouped">分组</SelectItem>
                        <SelectItem value="stacked">堆叠</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {chartType === "pie" ? (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">分类</span>
                  {items.map((item, index) => (
                    <SortableChartRow
                      key={item.id}
                      kind="items"
                      id={item.id}
                      index={index}
                      sending={sending}
                      draggingId={draggingId}
                      dropTargetId={dropTargetId}
                      onDragStart={startRowDrag}
                      onDragEnd={finishRowDrag}
                      onDragOver={handleRowDragOver}
                      onDrop={handleRowDrop}
                      onKeyDown={handleRowKeyDown}
                    >
                      <Input
                        aria-label={`分类 ${index + 1} 名称`}
                        placeholder="分类名称"
                        maxLength={64}
                        required
                        value={item.name}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((row) =>
                              row.id === item.id ? { ...row, name: event.target.value } : row,
                            ),
                          )
                        }
                      />
                      <Input
                        aria-label={`分类 ${index + 1} 数值`}
                        className="w-28 shrink-0"
                        type="number"
                        step="any"
                        min="0"
                        placeholder="数值"
                        required
                        value={item.value}
                        onChange={(event) =>
                          setItems((current) =>
                            current.map((row) =>
                              row.id === item.id ? { ...row, value: event.target.value } : row,
                            ),
                          )
                        }
                      />
                      <RemoveButton
                        label={`删除分类 ${index + 1}`}
                        disabled={items.length <= 2}
                        onClick={() =>
                          setItems((current) => current.filter((row) => row.id !== item.id))
                        }
                      />
                    </SortableChartRow>
                  ))}
                  <AddButton
                    label="添加分类"
                    disabled={items.length >= 5}
                    onClick={() => setItems((current) => [...current, newPieItem()])}
                  />
                </div>
              ) : (
                <>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">
                      {chartType === "radar" ? "维度" : labelName}
                    </span>
                    {chartType === "radar"
                      ? axes.map((axis, index) => (
                          <SortableChartRow
                            key={axis.id}
                            kind="axes"
                            id={axis.id}
                            index={index}
                            sending={sending}
                            draggingId={draggingId}
                            dropTargetId={dropTargetId}
                            onDragStart={startRowDrag}
                            onDragEnd={finishRowDrag}
                            onDragOver={handleRowDragOver}
                            onDrop={handleRowDrop}
                            onKeyDown={handleRowKeyDown}
                          >
                            <Input
                              aria-label={`维度 ${index + 1} 名称`}
                              placeholder={`维度 ${index + 1}`}
                              maxLength={64}
                              required
                              value={axis.name}
                              onChange={(event) =>
                                setAxes((current) =>
                                  current.map((item) =>
                                    item.id === axis.id
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <Input
                              aria-label={`维度 ${index + 1} 最大值`}
                              className="w-28 shrink-0"
                              type="number"
                              step="any"
                              min="0"
                              required
                              value={axis.max}
                              onChange={(event) =>
                                setAxes((current) =>
                                  current.map((item) =>
                                    item.id === axis.id
                                      ? { ...item, max: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <RemoveButton
                              label={`删除维度 ${index + 1}`}
                              disabled={axes.length <= 3}
                              onClick={() => updateDimension("axes", false, index)}
                            />
                          </SortableChartRow>
                        ))
                      : labels.map((label, index) => (
                          <SortableChartRow
                            key={label.id}
                            kind="labels"
                            rowName={labelName}
                            id={label.id}
                            index={index}
                            sending={sending}
                            draggingId={draggingId}
                            dropTargetId={dropTargetId}
                            onDragStart={startRowDrag}
                            onDragEnd={finishRowDrag}
                            onDragOver={handleRowDragOver}
                            onDrop={handleRowDrop}
                            onKeyDown={handleRowKeyDown}
                          >
                            <Input
                              aria-label={`${labelName} ${index + 1}`}
                              placeholder={`${labelName} ${index + 1}`}
                              maxLength={64}
                              required
                              value={label.label}
                              onChange={(event) =>
                                setLabels((current) =>
                                  current.map((item) =>
                                    item.id === label.id
                                      ? { ...item, label: event.target.value }
                                      : item,
                                  ),
                                )
                              }
                            />
                            <RemoveButton
                              label={`删除 ${labelName} ${index + 1}`}
                              disabled={labels.length <= (chartType === "line" ? 2 : 1)}
                              onClick={() => updateDimension("labels", false, index)}
                            />
                          </SortableChartRow>
                        ))}
                    <AddButton
                      label={chartType === "radar" ? "添加维度" : `添加 ${labelName}`}
                      disabled={chartType === "radar" ? axes.length >= 12 : labels.length >= 100}
                      onClick={() =>
                        updateDimension(chartType === "radar" ? "axes" : "labels", true)
                      }
                    />
                  </div>
                  <div className="grid gap-3">
                    <span className="text-sm font-medium">
                      {chartType === "line"
                        ? "折线数据"
                        : chartType === "bar"
                          ? "柱状数据"
                          : "数据系列"}
                    </span>
                    {series.map((item, seriesIndex) => (
                      <div className="grid gap-2 rounded-md border p-3" key={seriesIndex}>
                        <div className="flex gap-2">
                          <Input
                            aria-label={`系列 ${seriesIndex + 1} 名称`}
                            placeholder={`系列 ${seriesIndex + 1} 名称`}
                            maxLength={64}
                            required
                            value={item.name}
                            onChange={(event) =>
                              setSeries((current) =>
                                current.map((row, index) =>
                                  index === seriesIndex
                                    ? { ...row, name: event.target.value }
                                    : row,
                                ),
                              )
                            }
                          />
                          <RemoveButton
                            label={`删除系列 ${seriesIndex + 1}`}
                            disabled={series.length <= 1}
                            onClick={() =>
                              setSeries((current) =>
                                current.filter((_, index) => index !== seriesIndex),
                              )
                            }
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {Array.from({ length: dimensions }, (_, valueIndex) => (
                            <Field
                              key={valueIndex}
                              label={
                                (chartType === "radar"
                                  ? axes[valueIndex]?.name
                                  : labels[valueIndex]?.label) || `数值 ${valueIndex + 1}`
                              }
                            >
                              <Input
                                type="number"
                                step="any"
                                required
                                aria-label={`系列 ${seriesIndex + 1} 数值 ${valueIndex + 1}`}
                                value={item.values[valueIndex] ?? ""}
                                onChange={(event) =>
                                  setSeries((current) =>
                                    current.map((row, index) =>
                                      index === seriesIndex
                                        ? {
                                            ...row,
                                            values: Array.from(
                                              { length: dimensions },
                                              (_, position) =>
                                                position === valueIndex
                                                  ? event.target.value
                                                  : (row.values[position] ?? ""),
                                            ),
                                          }
                                        : row,
                                    ),
                                  )
                                }
                              />
                            </Field>
                          ))}
                        </div>
                      </div>
                    ))}
                    <AddButton
                      label={
                        chartType === "line"
                          ? "添加折线数据"
                          : chartType === "bar"
                            ? "添加柱状数据"
                            : "添加系列"
                      }
                      disabled={series.length >= 5}
                      onClick={() =>
                        setSeries((current) => [
                          ...current,
                          { name: "", values: Array(dimensions).fill("") as string[] },
                        ])
                      }
                    />
                  </div>
                </>
              )}
              <section className="grid gap-2" aria-label="图表预览">
                <h3 className="text-sm font-medium">预览图表</h3>
                <div className="flex min-h-32 min-w-0 justify-center rounded-lg border bg-card p-4">
                  {previewBody ? (
                    <ChartBody body={previewBody} className="w-full" />
                  ) : (
                    <p className="self-center text-sm text-muted-foreground">
                      填写完整图表参数后显示预览
                    </p>
                  )}
                </div>
              </section>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => {
                reset()
                onOpenChange(false)
              }}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="bg-xgui-brand text-primary-foreground hover:bg-xgui-brand-4"
              disabled={sending || !title.trim() || !description.trim()}
            >
              {sending && (
                <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
              )}
              发送
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SortableChartRow({
  kind,
  rowName,
  id,
  index,
  sending,
  draggingId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onKeyDown,
  children,
}: {
  kind: RowKind
  rowName?: string
  id: string
  index: number
  sending: boolean
  draggingId: string | null
  dropTargetId: string | null
  onDragStart: (event: DragEvent<HTMLSpanElement>, kind: RowKind, id: string) => void
  onDragEnd: () => void
  onDragOver: (event: DragEvent<HTMLDivElement>, kind: RowKind, id: string) => void
  onDrop: (event: DragEvent<HTMLDivElement>, kind: RowKind, id: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLSpanElement>, kind: RowKind, index: number) => void
  children: React.ReactNode
}) {
  const name = rowName ?? (kind === "axes" ? "维度" : kind === "labels" ? "标签" : "分类")
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md",
        draggingId === id && "opacity-40",
        dropTargetId === id && "bg-muted",
      )}
      onDragOver={(event) => onDragOver(event, kind, id)}
      onDrop={(event) => onDrop(event, kind, id)}
    >
      <span
        role="button"
        tabIndex={sending ? -1 : 0}
        aria-disabled={sending}
        aria-label={`拖动${name} ${index + 1} 排序，或按上下方向键调整`}
        title="拖动排序，或按上下方向键调整"
        className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:cursor-grabbing"
        draggable={!sending}
        onDragStart={(event) => onDragStart(event, kind, id)}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => onKeyDown(event, kind, index)}
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" aria-hidden />
      </span>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm">
      {label}
      {children}
    </label>
  )
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button size="sm" type="button" variant="outline" disabled={disabled} onClick={onClick}>
      <HugeiconsIcon icon={PlusSignIcon} className="size-4" aria-hidden />
      {label}
    </Button>
  )
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="icon-sm"
      type="button"
      variant="ghost"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <HugeiconsIcon icon={Delete02Icon} className="size-4" aria-hidden />
    </Button>
  )
}
