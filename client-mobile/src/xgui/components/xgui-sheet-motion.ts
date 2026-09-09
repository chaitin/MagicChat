export const XGUI_SHEET_OPEN_DURATION_MS = 180
export const XGUI_SHEET_CLOSE_DURATION_MS = 150
export const XGUI_SHEET_BOTTOM_OVERSCAN = 20
export const XGUI_SHEET_SPRING_CONFIG = {
  damping: 25,
  mass: 1,
  stiffness: 550,
} as const

const XGUI_SHEET_UPWARD_DRAG_MAX_DISTANCE = XGUI_SHEET_BOTTOM_OVERSCAN
const XGUI_SHEET_UPWARD_DRAG_RESISTANCE = 0.25

export function getXGUISheetDragTranslateY(dragY: number) {
  if (dragY >= 0) return dragY
  return -Math.min(
    XGUI_SHEET_UPWARD_DRAG_MAX_DISTANCE,
    Math.abs(dragY) * XGUI_SHEET_UPWARD_DRAG_RESISTANCE
  )
}
