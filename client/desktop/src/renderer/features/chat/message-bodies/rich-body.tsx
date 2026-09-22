import { useId, useState, type ReactNode } from "react"
import { ExternalLinkIcon, Loading03Icon } from "@hugeicons/core-free-icons"
import type { DesktopMessageBody, DesktopMessageChoiceState } from "../../../../shared/account-data"
import { HugeiconsIcon } from "@/components/icons/hugeicons-icon"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import { MarkdownBody, TextBody } from "./text-body"

export function LinkBody({ title, url }: { title: string; url: string }) {
  const { showToast } = useAnimatedToast()

  async function openLink() {
    if (typeof window.desktop?.openWebLink !== "function") {
      showToast({ status: "error", title: "请重启桌面端后再打开链接" })
      return
    }
    try {
      const result = await window.desktop.openWebLink(url)
      if (!result.ok) showToast({ status: "error", title: result.error.message })
    } catch {
      showToast({ status: "error", title: "无法打开链接" })
    }
  }

  return (
    <div className="flex w-80 max-w-full items-center gap-3">
      <HugeiconsIcon
        icon={ExternalLinkIcon}
        className="size-7 shrink-0 text-foreground"
        strokeWidth={1.5}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="truncate">{title}</div>
        <button
          type="button"
          className="block max-w-full cursor-pointer truncate text-left text-xs text-muted-foreground group-hover/bubble:text-xgui-link"
          title={url}
          onClick={() => void openLink()}
        >
          {url}
        </button>
      </div>
    </div>
  )
}

export function CardBody({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  const { showToast } = useAnimatedToast()

  async function openLink() {
    if (typeof window.desktop?.openWebLink !== "function") {
      showToast({ status: "error", title: "请重启桌面端后再打开链接" })
      return
    }
    try {
      const result = await window.desktop.openWebLink(url)
      if (!result.ok) showToast({ status: "error", title: result.error.message })
    } catch {
      showToast({ status: "error", title: "无法打开链接" })
    }
  }

  return (
    <button
      type="button"
      className="grid w-80 max-w-full cursor-pointer gap-2 text-left"
      onClick={() => void openLink()}
    >
      <span className="font-medium">{title}</span>
      <span className="line-clamp-3 text-muted-foreground">{description}</span>
    </button>
  )
}

export function ChoiceBody({
  body,
  messageId,
  choice,
  showResponseCounts,
  onRespond,
}: {
  body: Extract<DesktopMessageBody, { type: "choice" }>
  messageId?: string
  choice?: DesktopMessageChoiceState
  showResponseCounts: boolean
  onRespond?: (optionIds: string[]) => Promise<void>
}) {
  const { showToast } = useAnimatedToast()
  const generatedId = useId()
  const [draftOptionIds, setDraftOptionIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const answered = Boolean(choice?.myOptionIds.length)
  const selectedOptionIds = answered ? (choice?.myOptionIds ?? []) : draftOptionIds
  const canRespond = Boolean(messageId && onRespond)
  const countsByOptionId = new Map(
    choice?.options.map((option) => [option.id, option.responseCount]) ?? [],
  )

  function toggleMultipleOption(optionId: string, checked: boolean) {
    setDraftOptionIds((current) =>
      checked
        ? body.options
            .map((option) => option.id)
            .filter((id) => id === optionId || current.includes(id))
        : current.filter((id) => id !== optionId),
    )
  }

  async function submitResponse() {
    if (!onRespond || answered || selectedOptionIds.length === 0) return
    setSubmitting(true)
    try {
      await onRespond(selectedOptionIds)
    } catch (error) {
      showToast({
        status: "error",
        title: error instanceof Error ? error.message : "提交选择失败",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const optionRows = body.options.map((option) => {
    const id = `${messageId ?? generatedId}-${option.id}`
    const selected = selectedOptionIds.includes(option.id)
    return (
      <ChoiceOptionRow
        key={option.id}
        htmlFor={id}
        label={option.label}
        count={countsByOptionId.get(option.id) ?? 0}
        disabled={!canRespond || answered || submitting}
        selected={selected}
        showResponseCount={showResponseCounts}
        control={
          body.selection === "single" ? (
            <RadioGroupItem
              aria-label={option.label}
              className="data-[state=checked]:border-xgui-brand! data-[state=checked]:bg-xgui-brand! dark:data-[state=checked]:bg-xgui-brand!"
              id={id}
              value={option.id}
            />
          ) : (
            <Checkbox
              aria-label={option.label}
              checked={selected}
              className="data-checked:border-xgui-brand! data-checked:bg-xgui-brand! data-checked:text-primary-foreground! data-[state=checked]:border-xgui-brand! data-[state=checked]:bg-xgui-brand! data-[state=checked]:text-primary-foreground! aria-checked:border-xgui-brand! aria-checked:bg-xgui-brand! aria-checked:text-primary-foreground! dark:data-checked:bg-xgui-brand! dark:data-[state=checked]:bg-xgui-brand! dark:aria-checked:bg-xgui-brand!"
              disabled={!canRespond || answered || submitting}
              iconStrokeWidth={3}
              id={id}
              onCheckedChange={(checked) => toggleMultipleOption(option.id, checked === true)}
            />
          )
        }
      />
    )
  })

  return (
    <div className="w-120 max-w-full">
      <div className="mb-3">
        {body.contentType === "markdown" ? (
          <MarkdownBody content={body.content} />
        ) : (
          <TextBody content={body.content} />
        )}
      </div>
      {body.selection === "single" ? (
        <RadioGroup
          className="gap-2"
          disabled={!canRespond || answered || submitting}
          onValueChange={(value) => setDraftOptionIds([value])}
          value={selectedOptionIds[0] ?? ""}
        >
          {optionRows}
        </RadioGroup>
      ) : (
        <div className="grid gap-2">{optionRows}</div>
      )}
      {!answered && (
        <div className="mt-3 border-t border-foreground/10 pt-3">
          <Button
            className="w-full bg-xgui-brand text-background hover:bg-xgui-brand-4 hover:text-background active:bg-xgui-brand-5"
            disabled={!canRespond || submitting || selectedOptionIds.length === 0}
            onClick={() => void submitResponse()}
            size="sm"
            type="button"
          >
            {submitting && (
              <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" aria-hidden />
            )}
            提交
          </Button>
        </div>
      )}
    </div>
  )
}

function ChoiceOptionRow({
  control,
  count,
  disabled,
  htmlFor,
  label,
  selected,
  showResponseCount,
}: {
  control: ReactNode
  count: number
  disabled: boolean
  htmlFor: string
  label: string
  selected: boolean
  showResponseCount: boolean
}) {
  return (
    <label
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border border-foreground/10 px-3 py-2 transition-colors",
        !disabled && "hover:border-xgui-brand/70 hover:bg-xgui-brand/20",
        selected && "border-xgui-brand/50 bg-xgui-brand/10",
      )}
      htmlFor={htmlFor}
    >
      {control}
      <span className="min-w-0 flex-1 wrap-break-word">{label}</span>
      {showResponseCount && (
        <Badge className="shrink-0 tabular-nums" variant="secondary">
          {count}
        </Badge>
      )}
    </label>
  )
}
