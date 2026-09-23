export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export function centerWindowWithinWorkArea(
  owner: WindowBounds,
  workArea: WindowBounds,
  preferredSize: { width: number; height: number },
): WindowBounds {
  const width = Math.min(preferredSize.width, workArea.width)
  const height = Math.min(preferredSize.height, workArea.height)
  const idealX = owner.x + (owner.width - width) / 2
  const idealY = owner.y + (owner.height - height) / 2
  return {
    x: clamp(Math.round(idealX), workArea.x, workArea.x + workArea.width - width),
    y: clamp(Math.round(idealY), workArea.y, workArea.y + workArea.height - height),
    width,
    height,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
