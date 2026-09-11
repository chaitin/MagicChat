export type XGUIPopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "top-start"

export type XGUIPopoverRect = {
  height: number
  width: number
  x: number
  y: number
}

export type XGUIPopoverInsets = {
  bottom: number
  left: number
  right: number
  top: number
}

export type XGUIPopoverLayout = {
  arrowX: number
  menuX: number
  menuY: number
  placement: XGUIPopoverPlacement
}

const EDGE_GAP = 8
const ANCHOR_GAP = 6
const ARROW_HEIGHT = 8
const ARROW_WIDTH = 16
const ARROW_EDGE_GAP = 7

export function calculateXGUIPopoverLayout({
  anchor,
  insets,
  menuHeight,
  menuWidth,
  placement,
  windowHeight,
  windowWidth,
}: {
  anchor: XGUIPopoverRect
  insets: XGUIPopoverInsets
  menuHeight: number
  menuWidth: number
  placement: XGUIPopoverPlacement
  windowHeight: number
  windowWidth: number
}): XGUIPopoverLayout {
  const requestedBottom = placement.startsWith("bottom")
  const availableBelow = windowHeight - insets.bottom - EDGE_GAP - (anchor.y + anchor.height)
  const availableAbove = anchor.y - insets.top - EDGE_GAP
  const required = menuHeight + ARROW_HEIGHT + ANCHOR_GAP
  const useBottom = requestedBottom
    ? availableBelow >= required || availableBelow >= availableAbove
    : !(availableAbove >= required || availableAbove >= availableBelow)
  const alignment = placement.endsWith("end") ? "end" : "start"
  const resolvedPlacement = `${useBottom ? "bottom" : "top"}-${alignment}` as XGUIPopoverPlacement
  const desiredX = alignment === "end" ? anchor.x + anchor.width - menuWidth : anchor.x
  const minX = insets.left + EDGE_GAP
  const maxX = Math.max(minX, windowWidth - insets.right - EDGE_GAP - menuWidth)
  const menuX = Math.min(maxX, Math.max(minX, desiredX))
  const anchorCenter = anchor.x + anchor.width / 2
  const arrowX = Math.min(
    menuWidth - ARROW_EDGE_GAP - ARROW_WIDTH,
    Math.max(ARROW_EDGE_GAP, anchorCenter - menuX - ARROW_WIDTH / 2)
  )
  const desiredY = useBottom
    ? anchor.y + anchor.height + ARROW_HEIGHT + ANCHOR_GAP
    : anchor.y - ARROW_HEIGHT - ANCHOR_GAP - menuHeight
  const minY = insets.top + EDGE_GAP
  const maxY = Math.max(minY, windowHeight - insets.bottom - EDGE_GAP - menuHeight)
  const menuY = Math.min(maxY, Math.max(minY, desiredY))

  return { arrowX, menuX, menuY, placement: resolvedPlacement }
}
