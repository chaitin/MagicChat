export const COLLAPSED_MESSAGE_HEIGHTS = {
  markdown: 240,
  text: 192,
} as const

export type CollapsibleMessageVariant = keyof typeof COLLAPSED_MESSAGE_HEIGHTS

export function getCollapsibleMessageLayout({
  contentHeight,
  expanded,
  variant,
}: {
  contentHeight: number | null
  expanded: boolean
  variant: CollapsibleMessageVariant
}) {
  const maxHeight = COLLAPSED_MESSAGE_HEIGHTS[variant]
  const canExpand = contentHeight !== null && contentHeight > maxHeight + 1

  return {
    canExpand,
    collapsed: canExpand && !expanded,
    viewportHeight:
      contentHeight === null
        ? null
        : expanded
          ? contentHeight
          : Math.min(contentHeight, maxHeight),
  }
}
