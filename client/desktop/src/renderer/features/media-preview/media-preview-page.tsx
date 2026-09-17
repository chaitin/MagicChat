import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { WindowTitleBar } from "@/components/window-title-bar"
import type { MediaPreviewPayload } from "../../../shared/media"

type Point = { x: number; y: number }

export function MediaPreviewPage() {
  const bridge = window.mediaPreview
  const [payload, setPayload] = useState<MediaPreviewPayload | null>(null)

  useEffect(() => {
    if (!bridge) return
    let cancelled = false
    void bridge.initialize().then((value) => {
      if (!cancelled) setPayload(value)
    })
    const unsubscribe = bridge.onChanged(setPayload)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [bridge])

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => {
      document.documentElement.classList.toggle("dark", media.matches)
      document.documentElement.style.colorScheme = media.matches ? "dark" : "light"
    }
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])

  const windowTitle = `即应 Chat - ${payload?.title || "媒体预览"}`

  useEffect(() => {
    document.title = windowTitle
  }, [windowTitle])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-black">
      <WindowTitleBar brandTitle={windowTitle} controls={bridge?.windowControls} />
      <main className="min-h-0 flex-1 overflow-hidden">
        {!payload ? (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            正在加载
          </div>
        ) : payload.category === "image" ? (
          <ImagePreview key={payload.resourceUrl} payload={payload} />
        ) : (
          <VideoPreview key={payload.resourceUrl} payload={payload} />
        )}
      </main>
    </div>
  )
}

function ImagePreview({ payload }: { payload: MediaPreviewPayload }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ pointerId: number; origin: Point; offset: Point } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)

  function reset() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    dragRef.current = null
    setDragging(false)
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    const previousZoom = zoom
    const nextZoom = Math.min(4, Math.max(0.25, previousZoom * (event.deltaY < 0 ? 1.1 : 0.9)))
    const rect = viewport.getBoundingClientRect()
    const pointer = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    }
    setZoom(nextZoom)
    setOffset(
      clampOffset(
        {
          x: pointer.x - ((pointer.x - offset.x) * nextZoom) / previousZoom,
          y: pointer.y - ((pointer.y - offset.y) * nextZoom) / previousZoom,
        },
        nextZoom,
        viewport,
        imageRef.current,
      ),
    )
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || zoom <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      offset,
    }
    setDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(
      clampOffset(
        {
          x: drag.offset.x + event.clientX - drag.origin.x,
          y: drag.offset.y + event.clientY - drag.origin.y,
        },
        zoom,
        event.currentTarget,
        imageRef.current,
      ),
    )
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }

  return (
    <div
      ref={viewportRef}
      className={`flex h-full touch-none select-none items-center justify-center overflow-hidden ${
        zoom > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      }`}
      onDoubleClick={reset}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
    >
      <img
        ref={imageRef}
        src={payload.resourceUrl}
        alt={payload.originalName || "图片预览"}
        draggable={false}
        className="max-h-full max-w-full object-contain will-change-transform"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
      />
      <div className="pointer-events-none absolute right-3 bottom-3 rounded bg-black/60 px-2 py-1 text-xs text-white/80">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  )
}

function VideoPreview({ payload }: { payload: MediaPreviewPayload }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <video
        src={payload.resourceUrl}
        className="max-h-full max-w-full bg-black"
        controls
        autoPlay
        preload="auto"
      />
    </div>
  )
}

function clampOffset(
  value: Point,
  zoom: number,
  viewport: HTMLElement,
  image: HTMLImageElement | null,
): Point {
  if (!image) return value
  const viewportRect = viewport.getBoundingClientRect()
  const naturalWidth = image.naturalWidth || viewportRect.width
  const naturalHeight = image.naturalHeight || viewportRect.height
  const fit = Math.min(1, viewportRect.width / naturalWidth, viewportRect.height / naturalHeight)
  const width = naturalWidth * fit * zoom
  const height = naturalHeight * fit * zoom
  const maximumX = Math.max(0, (width - viewportRect.width) / 2)
  const maximumY = Math.max(0, (height - viewportRect.height) / 2)
  return {
    x: Math.min(maximumX, Math.max(-maximumX, value.x)),
    y: Math.min(maximumY, Math.max(-maximumY, value.y)),
  }
}
