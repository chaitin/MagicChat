import type { ScreenshotWindowBounds } from "../shared/screenshot"

export type Point = { x: number; y: number }
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
export type ScreenshotRect = Point & { width: number; height: number }
export type DrawTool = "rectangle" | "ellipse" | "arrow" | "pen" | "mosaic"
export type Annotation =
  | { type: "rectangle" | "ellipse" | "arrow"; from: Point; to: Point }
  | { type: "pen" | "mosaic"; points: Point[] }

export function normalizeSelection(
  start: Point,
  end: Point,
  viewport: { width: number; height: number },
): ScreenshotRect {
  const sx = Math.max(0, Math.min(viewport.width, start.x))
  const sy = Math.max(0, Math.min(viewport.height, start.y))
  const ex = Math.max(0, Math.min(viewport.width, end.x))
  const ey = Math.max(0, Math.min(viewport.height, end.y))
  return {
    x: Math.min(sx, ex),
    y: Math.min(sy, ey),
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
  }
}

export function resizeSelection(
  original: ScreenshotRect,
  handle: ResizeHandle,
  delta: Point,
  viewport: { width: number; height: number },
): ScreenshotRect {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  let left = original.x
  let top = original.y
  let right = original.x + original.width
  let bottom = original.y + original.height
  const minWidth = Math.min(20, original.width)
  const minHeight = Math.min(20, original.height)
  if (handle.includes("w")) left = clamp(left + delta.x, 0, right - minWidth)
  if (handle.includes("e")) right = clamp(right + delta.x, left + minWidth, viewport.width)
  if (handle.includes("n")) top = clamp(top + delta.y, 0, bottom - minHeight)
  if (handle.includes("s")) bottom = clamp(bottom + delta.y, top + minHeight, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function moveSelection(
  original: ScreenshotRect,
  delta: Point,
  viewport: { width: number; height: number },
): ScreenshotRect {
  return {
    ...original,
    x: Math.max(0, Math.min(viewport.width - original.width, original.x + delta.x)),
    y: Math.max(0, Math.min(viewport.height - original.height, original.y + delta.y)),
  }
}

export function translateAnnotations(
  annotations: readonly Annotation[],
  delta: Point,
): Annotation[] {
  const translate = (point: Point): Point => ({ x: point.x - delta.x, y: point.y - delta.y })
  return annotations.map((annotation) => {
    if ("from" in annotation)
      return { ...annotation, from: translate(annotation.from), to: translate(annotation.to) }
    return { ...annotation, points: annotation.points.map(translate) }
  })
}

export function windowAtPoint(
  windows: readonly ScreenshotWindowBounds[],
  point: Point,
): ScreenshotWindowBounds | null {
  return (
    windows.find(
      (window) =>
        point.x >= window.x &&
        point.x <= window.x + window.width &&
        point.y >= window.y &&
        point.y <= window.y + window.height,
    ) ?? null
  )
}

export function toolbarPosition(
  selection: ScreenshotRect,
  viewport: { width: number; height: number },
  toolbar: { width: number; height: number },
): Point {
  const left = Math.max(
    8,
    Math.min(viewport.width - toolbar.width - 8, selection.x + selection.width - toolbar.width),
  )
  const below = selection.y + selection.height + 8
  const above = selection.y - toolbar.height - 8
  const top =
    below + toolbar.height <= viewport.height - 8
      ? below
      : above >= 8
        ? above
        : Math.max(
            8,
            Math.min(
              viewport.height - toolbar.height - 8,
              selection.y + selection.height - toolbar.height - 8,
            ),
          )
  return { x: left, y: top }
}

export function paintScreenshot(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  payload: { imageWidth: number; imageHeight: number },
  selection: ScreenshotRect,
  viewport: { width: number; height: number },
  annotations: readonly Annotation[],
): boolean {
  const scaleX = payload.imageWidth / viewport.width
  const scaleY = payload.imageHeight / viewport.height
  const sourceX = Math.min(Math.round(selection.x * scaleX), payload.imageWidth - 1)
  const sourceY = Math.min(Math.round(selection.y * scaleY), payload.imageHeight - 1)
  canvas.width = Math.min(Math.round(selection.width * scaleX), payload.imageWidth - sourceX)
  canvas.height = Math.min(Math.round(selection.height * scaleY), payload.imageHeight - sourceY)
  const context = canvas.getContext("2d")
  if (!context || !canvas.width || !canvas.height) return false
  context.drawImage(
    image,
    sourceX,
    sourceY,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  drawAnnotations(
    context,
    annotations,
    canvas.width / selection.width,
    canvas.height / selection.height,
  )
  return true
}

export function drawAnnotations(
  context: CanvasRenderingContext2D,
  annotations: readonly Annotation[],
  scaleX: number,
  scaleY: number,
) {
  context.save()
  context.beginPath()
  context.rect(0, 0, context.canvas.width, context.canvas.height)
  context.clip()
  context.strokeStyle = "#ff4d4f"
  context.fillStyle = "#ff4d4f"
  context.lineWidth = Math.max(2, 2 * Math.min(scaleX, scaleY))
  context.lineCap = "round"
  context.lineJoin = "round"
  const x = (point: Point) => point.x * scaleX
  const y = (point: Point) => point.y * scaleY

  for (const annotation of annotations) {
    if (annotation.type === "mosaic") {
      for (const point of annotation.points) drawMosaic(context, x(point), y(point), scaleX, scaleY)
      continue
    }
    if (annotation.type === "pen") {
      context.beginPath()
      annotation.points.forEach((point, index) => {
        if (index === 0) context.moveTo(x(point), y(point))
        else context.lineTo(x(point), y(point))
      })
      if (annotation.points.length === 1) {
        context.lineTo(x(annotation.points[0]) + 0.01, y(annotation.points[0]))
      }
      context.stroke()
      continue
    }
    if (!("from" in annotation)) continue
    const { from, to } = annotation
    context.beginPath()
    if (annotation.type === "rectangle") {
      context.rect(x(from), y(from), x(to) - x(from), y(to) - y(from))
    } else if (annotation.type === "ellipse") {
      const rx = Math.abs(x(to) - x(from)) / 2
      const ry = Math.abs(y(to) - y(from)) / 2
      if (rx > 0 && ry > 0)
        context.ellipse((x(from) + x(to)) / 2, (y(from) + y(to)) / 2, rx, ry, 0, 0, Math.PI * 2)
    } else {
      const angle = Math.atan2(y(to) - y(from), x(to) - x(from))
      const head = 12 * Math.min(scaleX, scaleY)
      context.moveTo(x(from), y(from))
      context.lineTo(x(to), y(to))
      context.moveTo(
        x(to) - head * Math.cos(angle - Math.PI / 6),
        y(to) - head * Math.sin(angle - Math.PI / 6),
      )
      context.lineTo(x(to), y(to))
      context.lineTo(
        x(to) - head * Math.cos(angle + Math.PI / 6),
        y(to) - head * Math.sin(angle + Math.PI / 6),
      )
    }
    context.stroke()
  }
  context.restore()
}

function drawMosaic(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  scaleX: number,
  scaleY: number,
) {
  const radiusX = Math.max(1, Math.round(14 * scaleX))
  const radiusY = Math.max(1, Math.round(14 * scaleY))
  const x = Math.max(0, Math.floor(centerX - radiusX))
  const y = Math.max(0, Math.floor(centerY - radiusY))
  const width = Math.min(context.canvas.width - x, radiusX * 2)
  const height = Math.min(context.canvas.height - y, radiusY * 2)
  if (width <= 0 || height <= 0) return
  const source = context.getImageData(x, y, width, height)
  const blockX = Math.max(4, Math.round(8 * scaleX))
  const blockY = Math.max(4, Math.round(8 * scaleY))
  for (let top = 0; top < height; top += blockY) {
    for (let left = 0; left < width; left += blockX) {
      const pixel = (top * width + left) * 4
      context.fillStyle = `rgb(${source.data[pixel]}, ${source.data[pixel + 1]}, ${source.data[pixel + 2]})`
      context.fillRect(
        x + left,
        y + top,
        Math.min(blockX, width - left),
        Math.min(blockY, height - top),
      )
    }
  }
}
