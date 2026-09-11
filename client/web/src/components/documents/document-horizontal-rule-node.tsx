import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function DocumentHorizontalRuleNodeView({
  node,
  updateAttributes,
}: NodeViewProps) {
  const thickness = normalizeThickness(node.attrs.thickness)
  const lineStyle = normalizeLineStyle(node.attrs.lineStyle)

  return (
    <NodeViewWrapper className="document-horizontal-rule">
      <Popover>
        <PopoverTrigger asChild>
          <div
            aria-label="设置分割线"
            className="document-horizontal-rule__body"
            role="button"
            tabIndex={0}
          >
            <hr
              className="document-horizontal-rule__line"
              style={{
                borderTopStyle: lineStyle,
                borderTopWidth: `${thickness}px`,
              }}
            />
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-auto p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="top"
        >
          <div
            className="flex min-h-9 w-max items-center gap-2"
            contentEditable={false}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="分割线粗细"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <LineThicknessIcon />
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-32">
                {Array.from({ length: 6 }, (_, index) => index + 1).map(
                  (value) => (
                    <DropdownMenuItem
                      aria-label={`${value}px 分割线`}
                      className="min-h-8 justify-center"
                      key={value}
                      onSelect={() => updateAttributes({ thickness: value })}
                    >
                      <span
                        aria-hidden
                        className="w-20 border-t border-foreground"
                        style={{ borderTopWidth: `${value}px` }}
                      />
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="分割线样式"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <LineStyleIcon />
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-32">
                {lineStyleOptions.map((item) => (
                  <DropdownMenuItem
                    aria-label={`${item.label}分割线`}
                    className="min-h-8 justify-center"
                    key={item.value}
                    onSelect={() =>
                      updateAttributes({
                        lineStyle: item.value,
                        thickness:
                          item.value === "double"
                            ? Math.max(thickness, 3)
                            : thickness,
                      })
                    }
                  >
                    <span
                      aria-hidden
                      className="w-20 border-t border-foreground"
                      style={{
                        borderTopStyle: item.value,
                        borderTopWidth: item.value === "double" ? "3px" : "2px",
                      }}
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  )
}

function LineThicknessIcon() {
  return (
    <svg aria-hidden className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M0 4H24" stroke="currentColor" strokeWidth="2" />
      <path d="M0 10H24" stroke="currentColor" strokeWidth="4" />
      <path d="M0 18H24" stroke="currentColor" strokeWidth="6" />
    </svg>
  )
}

function LineStyleIcon() {
  return (
    <svg aria-hidden className="size-4" fill="none" viewBox="0 0 24 24">
      <path d="M3 5H21" stroke="currentColor" strokeWidth="2" />
      <path
        d="M3 12H21"
        stroke="currentColor"
        strokeDasharray="4 3"
        strokeWidth="2"
      />
      <path
        d="M3 19H21"
        stroke="currentColor"
        strokeDasharray="1 3"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  )
}

const lineStyleOptions = [
  { label: "实线", value: "solid" },
  { label: "虚线", value: "dashed" },
  { label: "点线", value: "dotted" },
  { label: "双线", value: "double" },
] as const

type DocumentHorizontalRuleStyle = (typeof lineStyleOptions)[number]["value"]

function normalizeLineStyle(value: unknown): DocumentHorizontalRuleStyle {
  return value === "dashed" || value === "dotted" || value === "double"
    ? value
    : "solid"
}

function normalizeThickness(value: unknown) {
  const thickness = typeof value === "number" ? value : Number(value)
  return Number.isFinite(thickness)
    ? Math.min(Math.max(Math.round(thickness), 1), 6)
    : 1
}
